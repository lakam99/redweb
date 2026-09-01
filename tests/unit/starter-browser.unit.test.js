'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const filename = path.resolve(__dirname, '../../scripts/lib/verify-starter-browser.js');

// Explicit process/browser boundary units; the separate integration uses native Chromium.
test.each(['pass', 'configured', 'invalid', 'no-browser', 'source', 'source-present', 'start', 'listen', 'launch', 'evaluate',
    'tab-close', 'stop', 'uncertain', 'signal', 'shutdown', 'combined', 'stderr', 'unref'])('starter browser ownership handles %s', async mode => {
    const events = [], apps = [], tabs = [];
    const execution = { directory: path.resolve('unit-starter-browser') };
    const primary = new Error('unit workload failed');
    const cleanup = new Error('unit cleanup failed');
    const child = { exitCode: null, signalCode: null,
        stderr: { destroy() { events.push('stderr'); if (mode === 'stderr') throw cleanup; } },
        unref() { events.push('unref'); if (mode === 'unref') throw cleanup; } };
    const nativeRequire = createRequire(filename);
    const requireBoundary = name => {
        if (name === 'node:fs') return {
            mkdirSync() {},
            existsSync: file => file === 'chromium' ? mode !== 'no-browser'
                : path.basename(file) === 'source-not-deployed' ? mode !== 'source' : path.basename(file) !== 'src' || mode === 'source-present',
        };
        if (name.endsWith(path.join('dist', 'app'))) return { createApp() {
            if (mode === 'start') throw primary;
            const index = apps.length;
            const app = { server: { address: () => ({ port: 9000 + index }) }, async shutdown() {
                events.push(`shutdown-${index}`);
                if (mode === 'shutdown' || mode === 'combined') throw cleanup;
            } };
            apps.push(app); return app;
        } };
        if (name === '../verify-live-html-browser') return {
            browserCandidates: ['chromium'], eventual: expression => expression,
            combineFailures: (first, second) => !second ? first : !first ? second : new AggregateError([first, second], first.message, { cause: first }),
            async launchBrowserWithRetry(_executable, _profile, options) {
                expect(options).toEqual({ headless: false });
                events.push('launch'); if (mode === 'launch') throw primary;
                return { browser: { child }, endpoint: 'ws://127.0.0.1:9222/unit' };
            },
            async openPage() {
                const page = { socket: { terminate() { events.push('tab-close'); if (mode === 'tab-close') throw cleanup; } },
                    async command() {}, async evaluate(expression) {
                        if (mode === 'evaluate' || mode === 'combined') throw primary;
                        if (expression.includes('getComputedStyle')) {
                            if (expression.includes('"nav a"')) return 'rgb(255, 135, 149)';
                            return expression.includes('".composer button"') ? 'rgb(34, 211, 238)' : 'rgb(255, 80, 100)';
                        }
                        return true;
                    } };
                tabs.push(page); return page;
            },
            async stopBrowser() { events.push('stop'); if (['stop', 'stderr', 'unref'].includes(mode)) throw cleanup;
                if (mode === 'signal') child.signalCode = 'SIGTERM'; else if (mode !== 'uncertain') child.exitCode = 0; },
        };
        if (name === '../../tests/helpers/network') return {
            withTimeout: promise => promise,
            async waitForListening() { if (mode === 'listen') throw primary; },
        };
        return nativeRequire(name);
    };
    const context = { module: { exports: {} }, require: requireBoundary, URL,
        process: { env: mode === 'configured' ? { REDWEB_BROWSER: 'configured-browser' } : {} },
        console: { log() {} } };
    vm.runInNewContext(createInstrumenter().instrumentSync(fs.readFileSync(filename, 'utf8'), filename), context, { filename });
    const result = await context.module.exports.verifyStarterBrowser(execution, mode === 'invalid' ? 'unknown' : undefined).catch(error => error);
    if (['pass', 'configured', 'signal'].includes(mode)) {
        expect(result).toEqual({ headed: true, realtime: true, chat: true, site: true });
        expect(execution.cleanupFailure).toBeUndefined();
    } else expect(require('node:util').types.isNativeError(result)).toBe(true);
    for (let index = 0; index < apps.length; index++) expect(events).toContain(`shutdown-${index}`);
    if (tabs.length) expect(events).toContain('stop');
    if (['launch', 'tab-close', 'stop', 'uncertain', 'shutdown', 'combined', 'stderr', 'unref'].includes(mode)) {
        expect(require('node:util').types.isNativeError(execution.cleanupFailure)).toBe(true);
    }
    if (['stop', 'uncertain', 'stderr', 'unref'].includes(mode)) {
        expect(events).toEqual(expect.arrayContaining(['stderr', 'unref']));
    }
    if (process.argv.includes('--collectCoverageFrom=scripts/lib/verify-starter-browser.js')) {
        const combined = createCoverageMap(globalThis.__coverage__ || {});
        combined.merge(context.__coverage__);
        globalThis.__coverage__ ||= {};
        globalThis.__coverage__[filename] = combined.fileCoverageFor(filename).toJSON();
    }
});
