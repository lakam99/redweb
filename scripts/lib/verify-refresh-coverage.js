'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { RevisionPeer, verifyRefreshControls, headingReady } = require('./verify-refresh-controls');
const { withTimeout } = require('../../tests/helpers/network');
const { combineFailures } = require('../verify-live-html-browser');

class CoverageRevisionPeer extends RevisionPeer {
    constructor(coverage, instrumented) {
        let script = instrumented ? coverage.instrumented : coverage.source;
        // Place the excluded test bridge after the canonical startup call, inside
        // its lexical block. Fail closed if the generator's two call sites change.
        assert.equal(script.match(/\bpoll\(\);/g)?.length, 2);
        const insertion = script.lastIndexOf('poll();') + 'poll();'.length;
        script = script.slice(0, insertion) + '\nwindow.refreshTest = { poll, cleanup };\n' + script.slice(insertion);
        super(script + `
window.addEventListener('pagehide', () => {
    if (window.__redwebBrowserCoverage__) navigator.sendBeacon('/__coverage', JSON.stringify(window.__redwebBrowserCoverage__));
});`);
        this.coverage = coverage;
        this.failures = [];
        this.reports = 0;
    }

    respond(request, response) {
        if (request.url === '/heading-readiness') {
            response.setHeader('Content-Type', 'text/html');
            response.end('<body><p id="heading-readiness">A real document before its heading exists.</p></body>');
            return;
        }
        if (request.url === '/supplement') {
            response.setHeader('Content-Security-Policy', "script-src 'self'; style-src 'self'; object-src 'none'");
            response.setHeader('Content-Type', 'text/html');
            response.end(`<body>${this.markup}<script type="module" src="/__redweb/development.js?revision=${this.initialRevision ?? this.revision}"></script></body>`);
            return;
        }
        if (request.url === '/__redweb/development' && this.mode === 'non-json') {
            this.calls++; response.setHeader('Content-Type', 'text/plain'); response.end('not a revision'); return;
        }
        if (request.url !== '/__coverage') return super.respond(request, response);
        let body = '', bytes = 0, failed = false;
        const fail = error => { if (!failed) { failed = true; this.failures.push(error); } };
        request.on('error', fail);
        request.on('aborted', () => fail(new Error('Coverage upload was aborted')));
        request.on('data', chunk => {
            bytes += chunk.length;
            if (bytes > 1024 * 1024) { fail(new Error('Coverage upload exceeded 1 MiB')); request.destroy(); }
            else body += chunk;
        });
        request.on('end', () => {
            if (failed) return;
            try { this.coverage.collect(JSON.parse(body)); this.reports++; response.end(); }
            catch (error) { fail(error); response.statusCode = 400; response.end(); }
        });
    }
}

async function verifyRefreshCoverage({ coverage, instrumented, visit, debugPort, directory, run, onPeer }) {
    const peer = new CoverageRevisionPeer(coverage, instrumented);
    onPeer(peer);
    const bounded = (promise, label) => withTimeout(promise, label, 15000);
    const until = async (check, label) => {
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            if (await check()) return;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('Timed out: ' + label);
    };
    const open = async (_port, url) => {
        const tab = await visit(url);
        run.browser = await bounded(tab.command('Browser.getVersion'), 'browser version');
        return { ...tab, evaluate: expression => bounded(tab.evaluate(expression), 'refresh evaluation'), command: (method, params) => bounded(tab.command(method, params), method) };
    };
    const collect = async tab => {
        if (instrumented) {
            const snapshot = await tab.evaluate('window.__redwebBrowserCoverage__');
            if (snapshot) { coverage.collect(snapshot); return true; }
        }
    };
    const closePage = async tab => {
        let failure, snapshot;
        try { snapshot = await collect(tab); } catch (error) { failure = error; }
        try {
            if (snapshot) {
                const reports = peer.reports;
                await tab.command('Page.navigate', { url: 'about:blank' });
                await until(() => peer.reports > reports, 'final pagehide coverage delivery');
            }
        } catch (error) { failure = combineFailures(failure, error); }
        try { await tab.command('Page.close'); } catch (error) { failure = combineFailures(failure, error); }
        finally { tab.socket.terminate(); }
        if (failure) throw failure;
    };
    const usingPage = async (url, operation) => {
        const tab = await open(debugPort, url);
        let failure;
        try { await operation(tab); } catch (error) { failure = error; }
        try { await closePage(tab); } catch (error) { failure = combineFailures(failure, error); }
        if (failure) throw failure;
    };
    const click = async (tab, expression) => {
        const point = await tab.evaluate(`(() => { const box = (${expression}).getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()`);
        for (const type of ['mousePressed', 'mouseReleased']) await tab.command('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
    };
    await verifyRefreshControls(debugPort, directory, { peer, open, until, click, closePage, afterChecks: async () => {
        await usingPage(peer.url + '/heading-readiness', async tab => {
            await until(() => tab.evaluate('Boolean(document.getElementById("heading-readiness"))'), 'heading readiness fixture');
            // Reproduce the concrete missing-heading defect without pretending
            // the saved CI log captured the original browser exception details.
            const previous = await tab.command('Runtime.evaluate', { expression: 'document.querySelector("h1").textContent === "Away"' });
            assert.match(previous.exceptionDetails?.exception?.description, /TypeError.*textContent/);
            for (const text of ['Away', 'Revision fixture']) assert.equal(await tab.evaluate(headingReady(text)), false);
            await assert.rejects(tab.evaluate('(() => { throw new Error("readiness negative control"); })()'), /Uncaught/);
            await tab.command('Page.navigate', { url: peer.url + '/away' });
            await until(() => tab.evaluate(headingReady('Away')), 'readiness actual away heading');
            assert.equal(await tab.evaluate(headingReady('Revision fixture')), false);
            await tab.command('Page.navigate', { url: peer.url });
            await until(() => tab.evaluate(headingReady('Revision fixture')), 'readiness actual restored heading');
            assert.equal(await tab.evaluate(headingReady('Away')), false);
            await until(() => tab.evaluate('Boolean(document.getElementById("__redweb_dev")?.shadowRoot)'), 'readiness refresh module');
        });
        peer.kind = 'input';
        peer.revision = randomUUID();
        await usingPage(peer.url, async clean => {
            await until(() => clean.evaluate('Boolean(document.getElementById("__redweb_dev")?.shadowRoot)'), 'clean startup');
            await clean.evaluate('window.original = true');
            const reports = peer.reports;
            peer.revision = randomUUID();
            await until(async () => { try { return await clean.evaluate('window.original === undefined'); } catch { return false; } }, 'real clean reload');
            if (instrumented) await until(() => peer.reports > reports, 'pre-reload coverage received');
            assert.equal(await clean.evaluate('document.querySelector("h1").textContent'), 'Revision fixture');
        });
        for (const markup of ['', '<rw-dev-refresh id="__redweb_dev"></rw-dev-refresh>']) {
            peer.markup = markup;
            peer.initialRevision = 'invalid';
            await usingPage(peer.url + '/supplement', async invalid => {
                assert.equal(await invalid.evaluate('Boolean(document.getElementById("__redweb_dev")?.shadowRoot)'), false);
            });
        }
        peer.initialRevision = undefined;
        peer.markup = '<h1>Edits</h1><input type="checkbox"><input type="radio"><input type="hidden" value="hidden"><input id="draft"><rw-dev-refresh id="__redweb_dev"></rw-dev-refresh>';
        await usingPage(peer.url + '/supplement', async edited => {
            await until(() => edited.evaluate('Boolean(window.refreshTest)'), 'supplement startup');
            await edited.evaluate(`document.querySelector('h1').dispatchEvent(new Event('input', { bubbles: true }))`);
            await click(edited, 'document.getElementById("draft")');
            await edited.command('Input.insertText', { text: 'keep this draft' });
            await edited.evaluate(`document.getElementById('draft').dispatchEvent(new Event('change', { bubbles: true }))`);
            peer.mode = 'non-json';
            const before = peer.calls;
            await until(() => peer.calls > before, 'non-JSON response');
            assert.equal(await edited.evaluate('document.getElementById("draft").value'), 'keep this draft');
            peer.mode = 'valid';
            peer.revision = randomUUID();
            await until(() => edited.evaluate('Boolean(document.getElementById("__redweb_dev").shadowRoot.querySelector("button"))'), 'edited restart notice');
            await edited.evaluate(`refreshTest.poll().then(() => true)`); // Native-function unit robustness after cleanup.
            const reports = peer.reports;
            await click(edited, 'document.getElementById("__redweb_dev").shadowRoot.querySelector("button")');
            await until(async () => { try { return await edited.evaluate('document.getElementById("draft").value === ""'); } catch { return false; } }, 'explicit discard reload');
            if (instrumented) await until(() => peer.reports > reports, 'discard coverage received');
        });
    } });
    if (peer.failures.length) throw new AggregateError(peer.failures, 'Refresh coverage collection failed');
    run[instrumented ? 'instrumentedCases' : 'plainCases'] = { controls: true, headingReadiness: true, cleanReload: true, invalidConfiguration: true, explicitDiscard: true, stoppedPollUnitCheck: true };
}

module.exports = { verifyRefreshCoverage, CoverageRevisionPeer };
