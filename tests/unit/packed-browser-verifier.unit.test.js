'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const filename = path.resolve(__dirname, '../../scripts/lib/verify-packed-browser.js');
const packageRoot = path.resolve('unit-installed-redweb');

// Explicit browser/process boundary faults, not browser integration substitutes.
test.each(['pass', 'environment', 'no-browser', 'import', 'start', 'listen', 'launch', 'page',
    'evaluate', 'draft', 'escaping', 'command', 'tab-close', 'stop', 'uncertain', 'signal',
    'shutdown', 'combined', 'late-page', 'late-close', 'stderr', 'unref', 'no-stderr', 'no-child'])
('packed browser verifier unit: %s', async mode => {
    const events = [], servers = [], tabs = [], execution = { directory: 'unit-profile' };
    const primary = new Error('unit operation failed');
    const cleanup = new Error('unit cleanup failed');
    let resolveLate;
    const child = { exitCode: null, signalCode: null,
        stderr: mode === 'no-stderr' ? undefined : { destroy() { events.push('stderr'); if (mode === 'stderr') throw cleanup; } },
        unref() { events.push('unref'); if (mode === 'unref') throw cleanup; } };
    const browser = mode === 'no-child' ? {} : { child };
    const start = (_Page, options) => {
        expect(options).toEqual({ port: 0, bind: '127.0.0.1', logger: null });
        if (mode === 'start') throw primary;
        const index = servers.length;
        const app = { server: { address: () => ({ port: 9000 + index }) }, shutdown: async () => {
            events.push(`shutdown-${index}`);
            if (['shutdown', 'combined'].includes(mode) && index === 0) throw cleanup;
        } };
        servers.push(app); return app;
    };
    const tab = () => {
        const index = tabs.length;
        const value = { socket: { terminate() {
            events.push(`tab-${index}`);
            if ((mode === 'tab-close' && index === 0) || mode === 'late-close') throw cleanup;
        } }, evaluate: async expression => {
            if (['evaluate', 'combined'].includes(mode)) throw primary;
            if (expression === 'document.querySelector("#chat-message").value') return mode === 'draft' ? 'wrong draft' : 'Unsent draft';
            if (expression === 'document.querySelector(".message-list b") === null') return mode !== 'escaping';
            return true;
        }, command: async () => { if (mode === 'command') throw primary; return { product: 'unit-browser' }; } };
        tabs.push(value); return value;
    };
    const nativeRequire = createRequire(filename);
    const requireBoundary = name => {
        if (name === 'node:fs') return { existsSync: () => mode !== 'no-browser' };
        if (name === packageRoot) { if (mode === 'import') throw primary; return { start }; }
        if (name === path.join(packageRoot, 'examples/live-html/counter.js')) return { CounterPage: class {} };
        if (name === path.join(packageRoot, 'examples/live-html/chatroom.js')) return { createChatroomPage: () => class {} };
        if (name === '../verify-live-html-browser') return {
            browserCandidates: ['unit-chromium'], eventual: expression => expression,
            launchBrowserWithRetry: async () => { events.push('launch'); if (mode === 'launch') throw primary; return { browser, endpoint: 'ws://127.0.0.1:9222/devtools/browser/unit' }; },
            openPage: async () => {
                events.push('open');
                if (mode === 'page') throw primary;
                if (mode.startsWith('late-')) return new Promise(resolve => { resolveLate = () => resolve(tab()); });
                return tab();
            },
            stopBrowser: async () => {
                events.push('stop');
                if (resolveLate) { resolveLate(); await Promise.resolve(); }
                if (['stop', 'stderr', 'unref', 'no-stderr', 'no-child'].includes(mode)) throw cleanup;
                if (mode === 'signal') child.signalCode = 'SIGTERM';
                else if (mode !== 'uncertain') child.exitCode = 0;
            },
        };
        if (name === '../../tests/helpers/network') return {
            waitForListening: async () => { events.push('listen'); if (mode === 'listen') throw primary; },
            withTimeout: (promise, label, milliseconds) => {
                expect(milliseconds).toBe(12000);
                if (mode.startsWith('late-') && label === 'browser page startup') {
                    // Observe the abandoned promise, as the actual timeout helper does.
                    promise.catch(() => {}); return Promise.reject(primary);
                }
                if (mode.startsWith('late-') && label === 'pending browser page') {
                    resolveLate();
                }
                return promise;
            },
        };
        return nativeRequire(name);
    };
    const context = { module: { exports: {} }, require: requireBoundary, URL,
        process: { env: mode === 'environment' ? { REDWEB_BROWSER: 'configured-browser' } : {} } };
    const code = createInstrumenter().instrumentSync(fs.readFileSync(filename, 'utf8'), filename);
    vm.runInNewContext(code, context, { filename });
    const result = await context.module.exports.verifyPackedBrowser(packageRoot, execution).catch(error => error);
    await new Promise(resolve => setImmediate(resolve));
    if (['pass', 'environment', 'signal'].includes(mode)) {
        expect(result).toEqual({ counter: true, chat: true, reconnect: true, disconnect: true, browser: { product: 'unit-browser' } });
        expect(execution.cleanupFailure).toBeUndefined();
    } else expect(require('node:util').types.isNativeError(result)).toBe(true);
    for (let index = 0; index < servers.length; index++) expect(events).toContain(`shutdown-${index}`);
    if (events.includes('open')) expect(events).toContain('stop');
    if (mode === 'tab-close') for (let index = 0; index < tabs.length; index++) expect(events).toContain(`tab-${index}`);
    if (['tab-close', 'late-close', 'stop', 'uncertain', 'shutdown', 'combined', 'launch', 'stderr', 'unref', 'no-stderr', 'no-child'].includes(mode)) {
        expect(require('node:util').types.isNativeError(execution.cleanupFailure)).toBe(true);
    }
    if (['combined', 'late-close'].includes(mode)) expect(result.cause).toBe(primary);
    if (['stderr', 'unref', 'no-stderr'].includes(mode)) expect(events).toContain('unref');
    if (process.argv.includes('--collectCoverageFrom=scripts/lib/verify-packed-browser.js')) {
        const combined = createCoverageMap(globalThis.__coverage__ || {});
        combined.merge(context.__coverage__);
        globalThis.__coverage__ ||= {};
        globalThis.__coverage__[filename] = combined.fileCoverageFor(filename).toJSON();
    }
});
