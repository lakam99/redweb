'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const filename = path.resolve(__dirname, '../../scripts/verify-browser-coverage.js');
const leaves = error => Array.isArray(error?.errors) ? error.errors.flatMap(leaves) : [error];

// Dependency-boundary units exercise host orchestration. Browser expression
// execution is proven by the separate native cases, not by these return values.
async function exercise(fault = '', mode = 'runtime') {
    const primary = new Error('unit operation'), cleanup = new Error('unit cleanup');
    const events = [], assets = [], run = {}, owner = { directory: 'unit-profile' };
    let instrumented = false, source = 'unit frontend', stops = 0;
    const frontends = { plain: 'unit plain', instrumented: 'unit instrumented', transport: { plain: 'unit transport', instrumented: 'unit covered transport' } };
    const tab = {
        socket: { terminate() { events.push('tab'); if (fault === 'tab') throw cleanup; } },
        command: async method => { events.push(method); return {}; },
        evaluate: async expression => {
            if (expression.startsWith('fetch(')) return fault === 'source-mismatch' ? 'wrong' : frontends[instrumented ? 'instrumented' : 'plain'];
            if (expression.includes('cases: await')) return { ok: fault !== 'feedback', error: 'unit feedback', cases: { assertions: fault === 'parity' && instrumented ? 2 : 1 } };
            if (expression.includes('cases: (')) return { ok: fault !== 'morph', error: 'unit morph', cases: { assertions: 1 } };
            if (expression.includes('protocol:')) { if (fault.startsWith('client-')) throw primary; return { protocol: {}, network: {} }; }
            if (expression.startsWith('window.__')) { if (fault === 'collect') throw primary; return {}; }
            if (expression.includes('selectedIndex !==')) return false;
            if (expression.endsWith('.selectedIndex')) return 1;
            if (expression.includes('const box')) return { x: 1, y: 2 };
            return true;
        },
    };
    const application = {
        server: { address: () => ({ port: 1 }), unref() { events.push('app-unref'); if (fault === 'app-unref') throw cleanup; } },
        shutdown: async () => { events.push('application'); if (fault.startsWith('app-')) throw primary; },
    };
    const browser = { child: { exitCode: null, signalCode: null,
        stderr: { destroy() { events.push('stderr'); if (fault === 'stderr') throw cleanup; } },
        unref() { events.push('browser-unref'); if (fault === 'browser-unref') throw cleanup; } } };
    const nativeRequire = createRequire(filename);
    const requireBoundary = name => {
        if (name === 'node:fs') return { existsSync: () => fault !== 'missing', readFileSync: () => source };
        if (name === 'express') return () => ({ get(route, handler) { assets.push([route, handler]); } });
        if (name === '..') return { start(_page, options) {
            options.logger.log(); options.logger.warn(); options.logger.error();
            return application;
        } };
        if (name === './lib/VerificationWorkspace') return { VerificationWorkspace: class { run(operation) { return operation(owner); } } };
        if (name === '../tests/helpers/network') return { withTimeout: promise => promise, waitForListening: async () => {} };
        if (name === './verify-live-html-browser') return {
            browserCandidates: ['unit-browser'], eventual: expression => expression,
            launchBrowserWithRetry: async () => {
                if (fault === 'launch') throw primary;
                return { browser, endpoint: 'ws://127.0.0.1:9222/unit' };
            },
            stopBrowser: async () => {
                events.push('stop'); stops++;
                if (['stop', 'stderr', 'browser-unref'].includes(fault)) throw primary;
                if (fault === 'signal') browser.child.signalCode = 'SIGTERM';
                else if (fault !== 'uncertain') browser.child.exitCode = 0;
            },
            openPage: async () => { if (fault === 'open') throw primary; return tab; },
        };
        if (name === './lib/verify-action-feedback') return { verifyActionFeedback: async options => {
            instrumented = Boolean(run.plainCases);
            options.onServer(application);
            for (const [route, handler] of assets.splice(0)) {
                let body;
                handler({}, { type(type) { expect(type).toBe('text/javascript'); return this; }, send(text) { body = text; } });
                const kind = instrumented ? 'instrumented' : 'plain';
                if (route === '/__redweb/test-client.js') expect(body).toBe(mode === 'source' ? frontends.transport[kind] : instrumented ? 'unit covered' : source);
                if (route === '/__redweb/client.js') expect(body).toBe(mode === 'source' ? frontends[kind] : mode === 'runtime' && instrumented ? 'unit covered' : source);
                if (route === '/__redweb/runtime.js') expect(body).toContain('mountLivePage()');
            }
            await options.afterChecks(await options.openPage(9222, 'unit-url'), {});
        } };
        if (name === './lib/verify-runtime-browser') return { verifyRuntimeBrowser: async () => ({ assertions: 1 }) };
        if (name === './lib/verify-live-page-ownership') return { verifyLivePageOwnership: async () => ({ assertions: 1 }) };
        if (name === '../tests/fixtures/BrowserClientPeer') return class {
            constructor() { this.url = 'ws://unit'; this.server = { unref() { events.push('client-unref'); if (fault === 'client-unref') throw cleanup; } }; }
            async run(operation) { return operation(); }
            async close() { events.push('client-close'); if (fault !== 'client-operation') throw cleanup; }
        };
        return nativeRequire(name);
    };
    requireBoundary.resolve = nativeRequire.resolve;
    const context = { require: requireBoundary, module: { exports: {} }, __dirname: path.dirname(filename),
        process: { env: {} }, console, URL };
    vm.runInNewContext(createInstrumenter().instrumentSync(fs.readFileSync(filename, 'utf8'), filename), context, { filename });
    let rejected = false, result;
    try { await context.module.exports.runBrowserChecks({ mode, run,
        coverage: { source, instrumented: 'unit covered', collect() { events.push('collect'); } },
        ...(mode === 'source' ? { frontends } : {}) }); }
    catch (error) { rejected = true; result = error; }
    if (process.argv.includes('--collectCoverageFrom=scripts/verify-browser-coverage.js')) {
        const map = createCoverageMap(globalThis.__coverage__ || {}); map.merge(context.__coverage__);
        globalThis.__coverage__ ||= {}; globalThis.__coverage__[filename] = map.fileCoverageFor(filename).toJSON();
    }
    return { rejected, result, primary, cleanup, run, events, owner, stops };
}

test.each(['runtime', 'client', 'source'])('routes plain/instrumented %s modules and collects the selected realm', async mode => {
    const result = await exercise('', mode);
    expect(result.rejected).toBe(false);
    expect(result.events).toEqual(expect.arrayContaining(['collect', 'application', 'stop']));
    expect(result.run.plainCases).toEqual(result.run.instrumentedCases);
    expect(result.stops).toBe(1);
});

test('confirmed signal termination satisfies browser cleanup', async () => {
    const result = await exercise('signal');
    expect(result.rejected).toBe(false);
    expect(result.owner.cleanupFailure).toBeUndefined();
    expect(result.stops).toBe(1);
});

test.each(['app-stop', 'app-unref'])('failed %s releases its handle while preserving uncertainty', async fault => {
    const result = await exercise(fault);
    expect(result.rejected).toBe(true);
    expect(leaves(result.result)).toContain(result.primary);
    expect(result.owner.cleanupFailure).toBeDefined();
    expect(result.events).toEqual(expect.arrayContaining(['app-unref', 'stop']));
    if (fault === 'app-unref') expect(leaves(result.result)).toContain(result.cleanup);
});

test.each(['client-operation', 'client-close', 'client-unref'])('preserves %s and attempts all owned cleanup', async fault => {
    const result = await exercise(fault, 'client');
    expect(result.rejected).toBe(true);
    expect(leaves(result.result)).toContain(result.primary);
    expect(result.events).toEqual(expect.arrayContaining(['client-close', 'application', 'stop']));
    if (fault !== 'client-operation') {
        expect(leaves(result.result)).toContain(result.cleanup);
        expect(result.events).toContain('client-unref');
        expect(result.owner.cleanupFailure).toBeDefined();
    }
});

test.each(['missing', 'launch', 'open', 'feedback', 'morph', 'parity', 'source-mismatch', 'collect', 'tab', 'stop', 'uncertain', 'stderr', 'browser-unref'])
('fails closed at %s without hiding the original problem', async fault => {
    const result = await exercise(fault, fault === 'source-mismatch' ? 'source' : 'runtime');
    expect(result.rejected).toBe(true);
    const messages = leaves(result.result).map(error => error.message).join('\n');
    const expected = { missing: 'Chromium is required', launch: 'unit operation', open: 'unit operation', feedback: 'unit feedback',
        morph: 'unit morph', parity: 'Plain and instrumented cases must agree', 'source-mismatch': 'Browser must receive',
        collect: 'unit operation', tab: 'unit cleanup', stop: 'unit operation', uncertain: 'Browser termination remains uncertain',
        stderr: 'unit operation', 'browser-unref': 'unit operation' };
    expect(messages).toContain(expected[fault]);
    if (!['missing', 'launch'].includes(fault)) expect(result.stops).toBe(1);
});
