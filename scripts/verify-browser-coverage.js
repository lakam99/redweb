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
const express = require('express');
const browserFeedback = require('../src/htmx/browserFeedback');
const browserRuntime = require('../src/htmx/browserRuntime');
const { verifyActionFeedback } = require('./lib/verify-action-feedback');
const runFeedbackCases = require('../tests/fixtures/browser-feedback-cases');
const { verifyRuntimeBrowser } = require('./lib/verify-runtime-browser');
const refreshBrowser = require('../src/development/refreshBrowser');
const { verifyRefreshCoverage } = require('./lib/verify-refresh-coverage');
const BrowserClientPeer = require('../tests/fixtures/BrowserClientPeer');
const clientProtocolCases = require('../tests/fixtures/client-protocol-cases');
const browserClientCases = require('../tests/fixtures/browser-client-cases');

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

async function verifyFeedback({ coverage, visit, debugPort, run, instrumented, onServer, onPeer, mode }) {
    const app = express();
    const runtime = browserRuntime('/__redweb/client.js');
    if (mode === 'client') {
        app.get('/__redweb/client.js', (_request, response) => response.type('text/javascript').send(
            instrumented ? coverage.instrumented : coverage.source));
    } else assert.equal(runtime.split(coverage.source).length, 2, 'Covered source must occur exactly once in the shipped runtime');
    app.get('/__redweb/runtime.js', (_request, response) => response.type('text/javascript').send(
        (mode === 'client' ? runtime : runtime.replace(coverage.source, () => instrumented ? coverage.instrumented : coverage.source)) +
        '\nwindow.feedbackTest = { feedback, showFeedback, refreshFeedback, indexSlots, slotOwners, feedbackNodes, revisions, performAction, client };' +
        '\nwindow.morph = { units, marker, rangeNodes, morphNode, morphContent, preserveFocus, applyPatch, clientNodes };' +
        '\nwindow.runtimeTest = { applyState, indexState, formValues, send, client };'));
    await verifyActionFeedback({
        debugPort, pages: [], eventual, serverOptions: { server: app }, onServer,
        openPage: async (_port, url) => {
            const tab = await visit(url);
            run.browser = await command(tab, 'Browser.getVersion');
            return { ...tab, evaluate: expression => evaluate(tab, expression), command: (method, params) => command(tab, method, params) };
        },
        afterChecks: async (tab, context) => {
            const result = await evaluate(tab, `(async () => {
                try { return { ok: true, cases: await (${runFeedbackCases.toString()})() }; }
                catch (error) { return { ok: false, error: error.stack }; }
            })()`);
            assert.ok(result.ok, result.error);
            if (mode === 'runtime' || mode === 'client') {
                result.cases.runtime = await verifyRuntimeBrowser(tab, context, eventual);
                result.cases.morph = await runCases(tab);
            }
            if (mode === 'client') {
                const peer = new BrowserClientPeer();
                onPeer(peer);
                await peer.run(async () => {
                    result.cases.client = await evaluate(tab, `(async () => {
                        const api = await import('/__redweb/client.js');
                        return { protocol: (${clientProtocolCases.toString()})(api),
                            network: await (${browserClientCases.toString()})(api, ${JSON.stringify(peer.url)}) };
                    })()`);
                });
                onPeer(undefined);
            }
            run[instrumented ? 'instrumentedCases' : 'plainCases'] = result.cases;
        },
    });
}

async function main() {
    const executable = process.env.REDWEB_BROWSER || browserCandidates.find(fs.existsSync);
    if (!executable) throw new Error('Chromium is required for generated browser coverage.');
    const mode = process.argv[2] || 'morph';
    const sources = { morph: browserMorph, feedback: browserFeedback, runtime: () => browserRuntime('/__redweb/client.js'), refresh: refreshBrowser,
        client: () => fs.readFileSync(path.join(path.dirname(require.resolve('redweb-client')), 'index.js'), 'utf8') };
    assert.ok(Object.hasOwn(sources, mode), 'Expected morph, feedback, runtime, refresh or client coverage mode');
    const coverage = new BrowserCoverage(mode === 'client' ? 'redweb-client.imported.js' : `browser${mode[0].toUpperCase() + mode.slice(1)}.generated.js`, sources[mode]());
    const run = { id: randomUUID(), startedAt: new Date().toISOString() };
    const outcome = await coverage.verify(() => new VerificationWorkspace().run(async execution => {
        let browser, coveredTab, application, refreshPeer, clientPeer, failure, launchAttempted = false;
        const tabs = [];
        const recordFailure = error => { failure = failure ? new AggregateError([failure, error], failure.message, { cause: failure }) : error; };
        const server = mode === 'morph' ? http.createServer((request, response) => {
            if (request.url === '/morph.js' || request.url === '/plain.js') {
                response.setHeader('Content-Type', 'text/javascript');
                response.end((request.url === '/plain.js' ? coverage.source : coverage.instrumented) + '\nwindow.morph = { units, marker, rangeNodes, morphNode, morphContent, preserveFocus, applyPatch, clientNodes };');
            } else if (request.url === '/' || request.url === '/plain') {
                response.setHeader('Content-Type', 'text/html');
                response.end(`<!doctype html><html><head><title>Native DOM coverage</title><script src="${request.url === '/plain' ? '/plain.js' : '/morph.js'}" defer></script></head><body></body></html>`);
            } else { response.statusCode = 404; response.end(); }
        }) : null;
        try {
            if (server) {
                server.listen(0, '127.0.0.1');
                await waitForListening(server);
            }
            launchAttempted = true;
            const launched = await launchBrowserWithRetry(executable, execution.directory);
            browser = launched.browser;
            const debugPort = new URL(launched.endpoint).port;
            const visit = async url => {
                const tab = await bounded(openPage(debugPort, url), 'browser page');
                tabs.push(tab);
                return tab;
            };
            if (mode === 'refresh') {
                for (const instrumented of [false, true]) await verifyRefreshCoverage({ coverage, instrumented, visit, debugPort, directory: execution.directory, run, onPeer: peer => { refreshPeer = peer; } });
                assert.deepEqual(run.instrumentedCases, run.plainCases);
            } else if (mode !== 'morph') {
                for (const instrumented of [false, true]) {
                    await verifyFeedback({
                        coverage, debugPort, run, instrumented, mode, onServer: server => { application = server; },
                        onPeer: peer => { clientPeer = peer; },
                        visit: async url => {
                            const tab = await visit(url);
                            if (instrumented) coveredTab = tab;
                            return tab;
                        },
                    });
                }
                assert.deepEqual(run.instrumentedCases, run.plainCases, 'Plain and instrumented cases must agree');
                run.integration = { transport: 'actual Redweb HTTP/WebSocket actions', cases: 'existing action feedback acceptance driver, twice' };
            } else {
                const plainTab = await visit(`http://127.0.0.1:${server.address().port}/plain`);
                run.browser = await command(plainTab, 'Browser.getVersion');
                run.plainCases = await runCases(plainTab);
                coveredTab = await visit(`http://127.0.0.1:${server.address().port}/`);
                run.instrumentedCases = await runCases(coveredTab);
                assert.deepEqual(run.instrumentedCases, run.plainCases, 'Plain and instrumented cases must agree');
                application = start(SelectionPage, { port: 0, bind: '127.0.0.1', logger: { log() {}, warn() {}, error() {} } });
                await waitForListening(application.server);
                run.integration = await verifyLiveSelection(await visit(`http://127.0.0.1:${application.server.address().port}/`));
            }
        } catch (error) { recordFailure(error); }
        finally {
            if (coveredTab) {
                try { coverage.collect(await evaluate(coveredTab, 'window.__redwebBrowserCoverage__')); }
                catch (error) { recordFailure(error); }
            }
            for (const tab of tabs) tab.socket.terminate();
            try { if (application) await bounded(application.shutdown(), 'live server shutdown'); }
            catch (error) { execution.cleanupFailure = error; recordFailure(error); }
            try { if (refreshPeer) await bounded(refreshPeer.pause(), 'revision peer cleanup'); }
            catch (error) { execution.cleanupFailure = error; refreshPeer.server.unref(); recordFailure(error); }
            try { if (clientPeer) await clientPeer.close(); }
            catch (error) { execution.cleanupFailure = error; clientPeer.server.unref(); recordFailure(error); }
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
                if (server) {
                    server.closeAllConnections();
                    await bounded(new Promise(resolve => server.close(resolve)), 'HTTP fixture shutdown');
                }
            } catch (error) { execution.cleanupFailure = error; server.unref(); recordFailure(error); }
        }
        if (failure) throw failure;
    }));
    // Final status includes VerificationWorkspace's filesystem cleanup result.
    const report = { ...outcome.report, ...run, endedAt: new Date().toISOString() };
    const destination = path.resolve(__dirname, '../coverage/browser-' + mode);
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
