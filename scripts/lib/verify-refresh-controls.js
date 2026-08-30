'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { randomUUID } = require('crypto');
const { openPage, combineFailures } = require('../verify-live-html-browser');
const refreshBrowser = require('../../src/development/refreshBrowser');
const styles = require('../../src/development/refreshStyles');

// A real HTTP peer for browser transport/lifecycle failure injection. No fetch,
// DOM, timer or WebSocket implementation is replaced by the test.
class RevisionPeer {
    constructor() {
        this.revision = randomUUID();
        this.mode = 'valid';
        this.kind = 'input';
        this.holdScript = false;
        this.scripts = new Set();
        this.pending = new Set();
        this.calls = 0;
        this.aborted = 0;
        this.maximumPending = 0;
        this.seen = [];
        this.server = http.createServer((request, response) => this.respond(request, response));
    }
    async listen() {
        await new Promise(resolve => this.server.listen(this.port || 0, '127.0.0.1', resolve));
        this.port = this.server.address().port;
        this.url = `http://127.0.0.1:${this.port}`;
    }
    async pause() {
        if (!this.server.listening) return;
        this.server.closeAllConnections();
        await new Promise(resolve => this.server.close(resolve));
    }
    releaseScripts() {
        this.holdScript = false;
        for (const response of this.scripts) response.end(refreshBrowser());
        this.scripts.clear();
    }
    respond(request, response) {
        this.seen.push(request.url);
        const pathname = new URL(request.url, this.url).pathname;
        if (pathname === '/') {
            const fields = {
                input: '<input id="field" />', password: '<input type="password" id="field" />',
                file: '<input type="file" id="field" />', contenteditable: '<div contenteditable="true" id="field"></div>',
                select: '<form id="external-form"></form><select id="field" form="external-form"><option>First</option><option>Second</option></select>',
            };
            response.setHeader('Content-Security-Policy', "script-src 'self'; style-src 'self'; object-src 'none'");
            response.setHeader('Content-Type', 'text/html');
            response.end(`<body><h1>Revision fixture</h1>${fields[this.kind]}<a id="away" href="/away">Away</a><rw-dev-refresh id="__redweb_dev"></rw-dev-refresh><script type="module" src="/__redweb/development.js?revision=${this.revision}"></script></body>`);
        } else if (pathname === '/away') {
            response.setHeader('Content-Type', 'text/html'); response.end('<h1>Away</h1>');
        } else if (pathname === '/__redweb/development.js') {
            response.setHeader('Content-Type', 'text/javascript');
            if (this.holdScript) { this.scripts.add(response); response.once('close', () => this.scripts.delete(response)); }
            else response.end(refreshBrowser());
        } else if (pathname === '/__redweb/development.css') {
            response.setHeader('Content-Type', 'text/css'); response.end(styles);
        } else if (pathname === '/__redweb/development') {
            this.calls++;
            this.pending.add(response);
            this.maximumPending = Math.max(this.maximumPending, this.pending.size);
            response.once('close', () => { this.pending.delete(response); if (!response.writableEnded) this.aborted++; });
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader('Content-Type', 'application/json');
            if (this.mode === 'redirect') { response.writeHead(302, { Location: '/away' }); response.end(); }
            else if (this.mode === 'malformed') response.end('{invalid');
            else if (this.mode === 'invalid') response.end('{"revision":"not-a-process-revision"}');
            else if (this.mode === 'partial') response.write('{"revision":');
            else response.end(JSON.stringify({ revision: this.revision }));
        } else { response.statusCode = 404; response.end(); }
    }
}

async function verifyRefreshControls(debugPort, directory, { until, click, closePage }) {
    const peer = new RevisionPeer();
    const pages = [];
    let failure;
    try {
        await peer.listen();
        const browser = await openPage(debugPort, 'about:blank');
        pages.push(browser);
        await browser.command('Page.addScriptToEvaluateOnNewDocument', { source: `window.__restores=[]; window.addEventListener('pageshow',event=>window.__restores.push(event.persisted));` });
        await browser.command('Page.navigate', { url: peer.url });
        await until(() => browser.evaluate('Boolean(document.getElementById("__redweb_dev")?.shadowRoot)'), 'control module');
        await browser.evaluate('window.__sameDocument = true');
        let failedRequests = 0;
        const requests = new Set();
        browser.socket.on('message', raw => {
            const message = JSON.parse(String(raw));
            if (message.method === 'Network.requestWillBeSent' && message.params.request.url === `${peer.url}/__redweb/development`) requests.add(message.params.requestId);
            if (message.method === 'Network.loadingFailed' && requests.has(message.params.requestId)) failedRequests++;
        });
        await browser.command('Network.enable');
        await peer.pause();
        await until(() => failedRequests > 0, 'actual disconnected listener');
        const beforeResume = peer.calls;
        await peer.listen();
        await until(() => peer.calls > beforeResume, 'same-revision transport recovery');
        assert.equal(await browser.evaluate('window.__sameDocument'), true);
        for (const mode of ['malformed', 'invalid', 'redirect']) {
            peer.mode = mode;
            const before = peer.calls;
            await until(() => peer.calls >= before + 2, `${mode} response polling`);
            assert.equal(await browser.evaluate('window.__sameDocument && !document.getElementById("__redweb_dev").shadowRoot.querySelector("button")'), true);
        }
        peer.mode = 'partial';
        await until(() => peer.aborted > 0, 'bounded partial response timeout');
        peer.mode = 'valid';
        assert.equal(peer.maximumPending, 1);
        const history = await browser.command('Page.getNavigationHistory');
        const entry = history.entries[history.currentIndex].id;
        await click(browser, 'document.getElementById("away")');
        await until(() => browser.evaluate('document.querySelector("h1").textContent === "Away"'), 'real away navigation');
        const beforeBack = peer.calls;
        await browser.command('Page.navigateToHistoryEntry', { entryId: entry });
        await until(() => browser.evaluate('document.querySelector("h1").textContent === "Revision fixture"'), 'history restoration');
        await until(() => peer.calls > beforeBack, 'polling resumes after history navigation');
        const restored = await browser.evaluate('window.__restores.includes(true)');
        console.log(`Refresh history navigation passed; actual back-forward-cache restoration observed: ${restored}.`);
        await closePage(browser, debugPort);
        pages.pop();

        const file = path.join(directory, 'refresh-upload.txt');
        fs.writeFileSync(file, 'real file-input fixture');
        for (const kind of ['input', 'password', 'file', 'contenteditable', 'select']) {
            peer.kind = kind;
            peer.holdScript = true;
            peer.revision = randomUUID();
            const delayed = await openPage(debugPort, 'about:blank');
            pages.push(delayed);
            await delayed.command('Page.addScriptToEvaluateOnNewDocument', { source: `window.__cspViolations=[]; document.addEventListener('securitypolicyviolation',event=>window.__cspViolations.push(event.violatedDirective));` });
            await delayed.command('Page.navigate', { url: peer.url });
            await until(() => delayed.evaluate('Boolean(document.getElementById("field"))'), 'HTML before delayed module');
            await until(() => peer.scripts.size > 0, 'held real module response');
            if (kind === 'file') {
                const document = await delayed.command('DOM.getDocument');
                const field = await delayed.command('DOM.querySelector', { nodeId: document.root.nodeId, selector: '#field' });
                await delayed.command('DOM.setFileInputFiles', { nodeId: field.nodeId, files: [file] });
            } else {
                await click(delayed, 'document.getElementById("field")');
                if (kind === 'select') {
                    await delayed.command('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
                    await delayed.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
                    await delayed.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 });
                    await delayed.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
                } else await delayed.command('Input.insertText', { text: 'private-unsent-draft' });
            }
            await click(delayed, 'document.querySelector("h1")');
            assert.equal(await delayed.evaluate('document.activeElement.id !== "field"'), true);
            await delayed.evaluate('window.__delayedDocument = true');
            peer.revision = randomUUID();
            peer.releaseScripts();
            await until(() => delayed.evaluate('Boolean(document.getElementById("__redweb_dev")?.shadowRoot?.querySelector("button"))'), `${kind} draft survives revision before script loading`);
            assert.equal(await delayed.evaluate('window.__delayedDocument'), true);
            const retained = kind === 'file' ? 'document.getElementById("field").files[0]?.name === "refresh-upload.txt"' :
                kind === 'contenteditable' ? 'document.getElementById("field").textContent === "private-unsent-draft"' :
                `document.getElementById("field").value === ${JSON.stringify(kind === 'select' ? 'Second' : 'private-unsent-draft')}`;
            assert.equal(await delayed.evaluate(retained), true);
            await until(() => delayed.evaluate('getComputedStyle(document.getElementById("__redweb_dev")).position === "fixed"'), 'self-only CSS');
            assert.deepEqual(await delayed.evaluate('window.__cspViolations'), []);
            assert.equal(await delayed.evaluate('localStorage.length === 0 && sessionStorage.length === 0'), true);
            await closePage(delayed, debugPort);
            pages.pop();
        }
        assert.ok(peer.seen.every(url => !url.includes('private-unsent-draft') && !url.includes('refresh-upload')));
        console.log('Refresh controls passed: actual outage/recovery, malformed/redirect/partial responses, bounded polling, delayed-script revision and input/password/file/contenteditable/select draft guards under self-only CSP.');
    } catch (error) { failure = error; }
    finally {
        for (const page of pages) {
            try { await closePage(page, debugPort); }
            catch (error) { failure = combineFailures(failure, error); }
        }
        try { peer.releaseScripts(); }
        catch (error) { failure = combineFailures(failure, error); }
        try { await peer.pause(); }
        catch (error) { failure = combineFailures(failure, error); }
    }
    if (failure) throw failure;
}

module.exports = { verifyRefreshControls };
