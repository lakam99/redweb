'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const BrowserCoverage = require('./lib/BrowserCoverage');
const { VerificationWorkspace } = require('./lib/VerificationWorkspace');
const { browserCandidates, launchBrowserWithRetry, stopBrowser, openPage, eventual } = require('./verify-live-html-browser');
const { withTimeout, waitForListening } = require('../tests/helpers/network');
const browserMorph = require('../src/htmx/browserMorph');
const runMorphCases = require('../tests/fixtures/browser-morph-cases');
const SelectionPage = require('../tests/fixtures/selection-page');
const { start } = require('..');

const bounded = (promise, label) => withTimeout(promise, label, 15000);
const evaluate = (tab, expression) => bounded(tab.evaluate(expression), 'browser evaluation');
const command = (tab, method, params) => bounded(tab.command(method, params), method);

async function runCases(tab) {
    const result = await evaluate(tab, `(() => {
        try { return { ok: true, cases: (${runMorphCases.toString()})() }; }
        catch (error) { return { ok: false, error: error.stack }; }
    })()`);
    if (!result.ok) throw new Error(result.error);
    return result.cases;
}

async function verifyLiveSelection(tab) {
    for (const id of ['single', 'multiple']) {
        await evaluate(tab, `document.getElementById(${JSON.stringify(id)}).focus()`);
        for (let attempt = 0; attempt < 3 && await evaluate(tab, `document.getElementById(${JSON.stringify(id)}).selectedIndex !== 1`); attempt++) {
            for (const type of ['keyDown', 'keyUp']) await command(tab, 'Input.dispatchKeyEvent', { type, key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
        }
        assert.equal(await evaluate(tab, `document.getElementById(${JSON.stringify(id)}).selectedIndex`), 1);
    }
    const click = async id => {
        const point = await evaluate(tab, `(() => { const box = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()`);
        for (const type of ['mousePressed', 'mouseReleased']) await command(tab, 'Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
    };
    await click('redraw');
    await evaluate(tab, eventual('document.getElementById("revision").textContent === "1"', 'server redraw'));
    assert.equal(await evaluate(tab, 'document.getElementById("single").selectedIndex === 1 && document.getElementById("multiple").selectedOptions.length === 1 && document.getElementById("multiple").options[1].selected'), true);
    await click('defaults');
    await evaluate(tab, eventual('document.getElementById("revision").textContent === "2"', 'server default update'));
    assert.equal(await evaluate(tab, 'document.getElementById("single").selectedIndex === 2 && document.getElementById("multiple").selectedOptions.length === 1 && document.getElementById("multiple").options[2].selected'), true);
    return { serverActions: 2, transport: 'live Redweb HTTP/WebSocket page', input: 'native keyboard and pointer events' };
}

async function main() {
    const executable = process.env.REDWEB_BROWSER || browserCandidates.find(fs.existsSync);
    if (!executable) throw new Error('Chromium is required for generated browser coverage.');
    const coverage = new BrowserCoverage('browserMorph.generated.js', browserMorph());
    const run = { id: randomUUID(), startedAt: new Date().toISOString() };
    const outcome = await coverage.verify(() => new VerificationWorkspace().run(async execution => {
        let browser, coveredTab, application, failure, launchAttempted = false;
        const tabs = [];
        const recordFailure = error => { failure = failure ? new AggregateError([failure, error], failure.message, { cause: failure }) : error; };
        const server = http.createServer((request, response) => {
            if (request.url === '/morph.js' || request.url === '/plain.js') {
                response.setHeader('Content-Type', 'text/javascript');
                response.end((request.url === '/plain.js' ? coverage.source : coverage.instrumented) + '\nwindow.morph = { units, marker, rangeNodes, morphNode, morphContent, preserveFocus, applyPatch, clientNodes };');
            } else if (request.url === '/' || request.url === '/plain') {
                response.setHeader('Content-Type', 'text/html');
                response.end(`<!doctype html><html><head><title>Native DOM coverage</title><script src="${request.url === '/plain' ? '/plain.js' : '/morph.js'}" defer></script></head><body></body></html>`);
            } else { response.statusCode = 404; response.end(); }
        });
        try {
            server.listen(0, '127.0.0.1');
            await waitForListening(server);
            launchAttempted = true;
            const launched = await launchBrowserWithRetry(executable, execution.directory);
            browser = launched.browser;
            const debugPort = new URL(launched.endpoint).port;
            const visit = async url => {
                const tab = await bounded(openPage(debugPort, url), 'browser page');
                tabs.push(tab);
                return tab;
            };
            const plainTab = await visit(`http://127.0.0.1:${server.address().port}/plain`);
            run.browser = await command(plainTab, 'Browser.getVersion');
            run.plainCases = await runCases(plainTab);
            coveredTab = await visit(`http://127.0.0.1:${server.address().port}/`);
            run.instrumentedCases = await runCases(coveredTab);
            assert.deepEqual(run.instrumentedCases, run.plainCases, 'Plain and instrumented cases must agree');
            application = start(SelectionPage, { port: 0, bind: '127.0.0.1', logger: { log() {}, warn() {}, error() {} } });
            await waitForListening(application.server);
            run.integration = await verifyLiveSelection(await visit(`http://127.0.0.1:${application.server.address().port}/`));
        } catch (error) { recordFailure(error); }
        finally {
            if (coveredTab) {
                try { coverage.collect(await evaluate(coveredTab, 'window.__redwebBrowserCoverage__')); }
                catch (error) { recordFailure(error); }
            }
            for (const tab of tabs) tab.socket.terminate();
            try { if (application) await bounded(application.shutdown(), 'live server shutdown'); }
            catch (error) { execution.cleanupFailure = error; recordFailure(error); }
            try {
                if (browser) {
                    await bounded(stopBrowser(browser.child), 'browser shutdown');
                    assert.ok(browser.child.exitCode !== null || browser.child.signalCode !== null, 'Browser termination remains uncertain');
                } else if (launchAttempted) throw new Error('Browser launch cleanup could not be independently verified');
            } catch (error) {
                execution.cleanupFailure = error;
                browser?.child.stderr?.destroy();
                browser?.child.unref();
                recordFailure(error);
            }
            try {
                server.closeAllConnections();
                await bounded(new Promise(resolve => server.close(resolve)), 'HTTP fixture shutdown');
            } catch (error) { execution.cleanupFailure = error; server.unref(); recordFailure(error); }
        }
        if (failure) throw failure;
    }));
    // Final status includes VerificationWorkspace's filesystem cleanup result.
    const report = { ...outcome.report, ...run, endedAt: new Date().toISOString() };
    const destination = path.resolve(__dirname, '../coverage/browser-morph');
    try {
        fs.mkdirSync(destination, { recursive: true });
        fs.writeFileSync(path.join(destination, coverage.filename), coverage.source);
        fs.writeFileSync(path.join(destination, 'report.json'), JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify({ ...report, coverage: undefined }, null, 2));
    } catch (error) {
        throw outcome.failure ? new AggregateError([outcome.failure, error], outcome.failure.message, { cause: outcome.failure }) : error;
    }
    if (outcome.failure) throw outcome.failure;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
