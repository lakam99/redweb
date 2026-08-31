'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const BrowserCoverage = require('./lib/BrowserCoverage');
const { VerificationWorkspace } = require('./lib/VerificationWorkspace');
const { verificationError } = require('./lib/verificationError');
const { BrowserPages } = require('./lib/BrowserPages');
const { browserCandidates, launchBrowserWithRetry, stopBrowser, openPage, eventual } = require('./verify-live-html-browser');
const { withTimeout, waitForListening } = require('../tests/helpers/network');

const runMorphCases = require('../tests/fixtures/browser-morph-cases');
const SelectionPage = require('../tests/fixtures/selection-page');
const { start } = require('..');
const express = require('express');


const { verifyActionFeedback } = require('./lib/verify-action-feedback');
const runFeedbackCases = require('../tests/fixtures/browser-feedback-cases');
const { verifyRuntimeBrowser } = require('./lib/verify-runtime-browser');
const refreshBrowser = require('../src/development/refreshBrowser');
const { verifyRefreshCoverage } = require('./lib/verify-refresh-coverage');
const BrowserClientPeer = require('../tests/fixtures/BrowserClientPeer');
const clientProtocolCases = require('../tests/fixtures/client-protocol-cases');
const browserClientCases = require('../tests/fixtures/browser-client-cases');
const { verifyLivePageOwnership } = require('./lib/verify-live-page-ownership');

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

async function verifyFeedback({ coverage, visit, debugPort, run, instrumented, onServer, onPeer, mode, frontends }) {
    const app = express();
    const frontend = frontends?.plain || fs.readFileSync(path.join(path.dirname(require.resolve('redweb-client/live-html')), 'live-html.js'), 'utf8');
    if (mode === 'client' || mode === 'source') {
        app.get('/__redweb/test-client.js', (_request, response) => response.type('text/javascript').send(
            mode === 'source' ? frontends.transport[instrumented ? 'instrumented' : 'plain'] :
                instrumented ? coverage.instrumented : coverage.source));
    } else if (mode !== 'source') assert.equal(frontend.split(coverage.source).length, 2, 'Covered frontend must occur exactly once in the shipped module');
    app.get('/__redweb/client.js', (_request, response) => response.type('text/javascript').send(
        mode === 'source' && instrumented ? frontends.instrumented :
            mode === 'runtime' && instrumented ? frontend.replace(coverage.source, () => coverage.instrumented) : frontend));
    app.get('/__redweb/runtime.js', (_request, response) => response.type('text/javascript').send(
        'import { mountLivePage } from "/__redweb/client.js";\n' +
        'const page = mountLivePage(); window.pageClient = page; window.mountLivePage = mountLivePage;\n' +
        'window.feedbackTest = { ...page.feedback, client: page.client };\n' +
        'window.morph = page.morph; window.runtimeTest = page.runtime;'));
    await verifyActionFeedback({
        debugPort, pages: [], eventual, serverOptions: { server: app }, onServer,
        openPage: async (_port, url) => {
            const tab = await visit(url);
            run.browser = await command(tab, 'Browser.getVersion');
            if (mode === 'source') {
                const expected = instrumented ? frontends.instrumented : frontends.plain;
                assert.equal(await evaluate(tab, `fetch('/__redweb/client.js').then(response => response.text())`), expected,
                    'Browser must receive the selected source-built candidate');
            }
            return tab;
        },
        afterChecks: async (tab, context) => {
            const result = await evaluate(tab, `(async () => {
                try { return { ok: true, cases: await (${runFeedbackCases.toString()})() }; }
                catch (error) { return { ok: false, error: error.stack }; }
            })()`);
            assert.ok(result.ok, result.error);
            if (mode === 'runtime' || mode === 'client' || mode === 'source') {
                result.cases.runtime = await verifyRuntimeBrowser(tab, context, eventual);
                result.cases.ownership = await verifyLivePageOwnership(tab, context, eventual);
                result.cases.morph = await runCases(tab);
            }
            if (mode === 'client' || mode === 'source') {
                const peer = new BrowserClientPeer();
                onPeer(peer);
                await peer.run(async () => {
                    result.cases.client = await evaluate(tab, `(async () => {
                        const api = await import('/__redweb/test-client.js');
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
    const mode = process.argv[2] || 'runtime';
    let bundle;
    let frontendOffset;
    let frontendEnd;
    const sources = {
        runtime: () => {
            bundle = fs.readFileSync(path.join(path.dirname(require.resolve('redweb-client/live-html')), 'live-html.js'), 'utf8');
            const modules = [...bundle.matchAll(/^\/\/ (src\/[^\r\n]+)$/gm)].map(match => match[1]);
            assert.deepEqual(modules, ['src/protocol.ts', 'src/client.ts', 'src/live-html/morph.js',
                'src/live-html/ActionFeedback.js', 'src/live-html/feedback.js', 'src/live-html/runtime.js', 'src/live-html.ts'],
                'Every bundled module must be assigned to the transport or frontend coverage scope');
            frontendOffset = bundle.indexOf('// src/live-html/morph.js');
            frontendEnd = bundle.lastIndexOf('\nexport {');
            assert.match(bundle.slice(frontendEnd), /^\nexport \{\s*RedwebClient,\s*mountLivePage2 as mountLivePage\s*\};\s*$/,
                'Only static export linkage may follow the covered frontend');
            return bundle.slice(frontendOffset, frontendEnd);
        },
        refresh: refreshBrowser,
        client: () => fs.readFileSync(path.join(path.dirname(require.resolve('redweb-client')), 'index.js'), 'utf8'),
    };
    assert.ok(Object.hasOwn(sources, mode), 'Expected runtime, refresh or client coverage mode');
    const coverage = new BrowserCoverage(mode === 'client' ? 'redweb-client.imported.js' : `browser${mode[0].toUpperCase() + mode.slice(1)}.generated.js`, sources[mode]());
    const run = { id: randomUUID(), startedAt: new Date().toISOString(),
        ...(bundle ? { bundleSha256: createHash('sha256').update(bundle).digest('hex'), frontendOffset, frontendEnd,
            scope: 'All bundled Live HTML modules; transport measured separately by client mode' } : {}) };
    const outcome = await coverage.verify(() => runBrowserChecks({ coverage, mode, run }));
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

async function runBrowserChecks({ coverage, mode, run, frontends }) {
    const executable = process.env.REDWEB_BROWSER || browserCandidates.find(fs.existsSync);
    if (!executable) throw new Error('Chromium is required for generated browser coverage.');
    return new VerificationWorkspace().run(async execution => {
        let browser, coveredTab, application, refreshPeer, clientPeer, failure, launchAttempted = false;
        const pages = new BrowserPages(execution, openPage, bounded);
        const recordFailure = value => { const error = verificationError(value); failure = failure ? new AggregateError([failure, error], failure.message, { cause: failure }) : error; };
        const recordCleanup = error => { execution.cleanupFailure = verificationError(error); recordFailure(error); };
        try {
            launchAttempted = true;
            const launched = await launchBrowserWithRetry(executable, execution.directory);
            browser = launched.browser;
            const debugPort = new URL(launched.endpoint).port;
            const visit = url => pages.open(debugPort, url);
            if (mode === 'refresh') {
                for (const instrumented of [false, true]) await verifyRefreshCoverage({ coverage, instrumented, visit, debugPort, directory: execution.directory, run, onPeer: peer => { refreshPeer = peer; } });
                assert.deepEqual(run.instrumentedCases, run.plainCases);
            } else {
                for (const instrumented of [false, true]) {
                    await verifyFeedback({
                        coverage, debugPort, run, instrumented, mode, frontends, onServer: server => { application = server; },
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
                application = start(SelectionPage, { port: 0, bind: '127.0.0.1', logger: { log() {}, warn() {}, error() {} } });
                await waitForListening(application.server);
                run.integration.selection = await verifyLiveSelection(await visit(`http://127.0.0.1:${application.server.address().port}/`));
            }
        } catch (error) { recordFailure(error); }
        finally {
            if (coveredTab) {
                try { coverage.collect(await evaluate(coveredTab, mode === 'source' ? 'window.__redwebApplicationCoverage__' : 'window.__redwebBrowserCoverage__')); }
                catch (error) { recordFailure(error); }
            }
            try { await pages.close(); } catch (error) { recordCleanup(error); }
            try { if (application) await bounded(application.shutdown(), 'live server shutdown'); }
            catch (error) { recordCleanup(error); }
            try { if (refreshPeer) await bounded(refreshPeer.pause(), 'revision peer cleanup'); }
            catch (error) {
                recordCleanup(error);
                try { refreshPeer.server.unref(); } catch (error) { recordCleanup(error); }
            }
            try { if (clientPeer) await clientPeer.close(); }
            catch (error) {
                recordCleanup(error);
                try { clientPeer.server.unref(); } catch (error) { recordCleanup(error); }
            }
            try {
                if (browser) {
                    await bounded(stopBrowser(browser.child), 'browser shutdown');
                    assert.ok(browser.child.exitCode !== null || browser.child.signalCode !== null, 'Browser termination remains uncertain');
                } else if (launchAttempted) throw new Error('Browser launch cleanup could not be independently verified');
            } catch (error) {
                recordCleanup(error);
                for (const release of [() => browser?.child?.stderr?.destroy(), () => browser?.child?.unref()]) {
                    try { release(); } catch (error) { recordCleanup(error); }
                }
            }
        }
        if (failure) throw failure;
    });
}

module.exports = { runBrowserChecks };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
