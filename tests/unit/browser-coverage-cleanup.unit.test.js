'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = path.resolve(__dirname, '../../scripts/verify-browser-coverage.js');

// Targeted coordinator fault units. Complete emitted-runtime acceptance runs
// separately in Chromium; these do not claim full coordinator-source coverage.
test.each(['undefined', 'null', 'false', 'zero', 'empty', 'object', 'tab', 'peer', 'peer-unref', 'stderr', 'unref'])
('browser coverage never loses %s failures or skips remaining cleanup', async mode => {
    const failures = { undefined, null: null, false: false, zero: 0, empty: '', object: Object.create(null) };
    const primary = Object.hasOwn(failures, mode) ? failures[mode] : new Error('unit browser operation failed');
    const cleanup = new Error('unit browser cleanup failed');
    const events = [], execution = { directory: 'unit-coverage-profile' };
    const browser = { child: { exitCode: null, signalCode: null,
        stderr: { destroy() { events.push('stderr'); if (mode === 'stderr') throw cleanup; } },
        unref() { events.push('unref'); if (mode === 'unref') throw cleanup; } } };
    const peer = { pause: async () => { events.push('peer'); if (mode.startsWith('peer')) throw cleanup; },
        server: { unref() { events.push('peer-unref'); if (mode === 'peer-unref') throw cleanup; } } };
    const nativeRequire = createRequire(filename);
    const requireBoundary = name => {
        if (name === 'node:fs') return { existsSync: () => true };
        if (name === './lib/VerificationWorkspace') return { VerificationWorkspace: class { run(operation) { return operation(execution); } } };
        if (name === './verify-live-html-browser') return {
            browserCandidates: ['unit-browser'], eventual: expression => expression,
            launchBrowserWithRetry: async () => ({ browser, endpoint: 'ws://127.0.0.1:9222/unit' }),
            stopBrowser: async () => {
                events.push('stop');
                if (['stderr', 'unref'].includes(mode)) throw cleanup;
                browser.child.exitCode = 0;
            },
            openPage: async () => ({ socket: { terminate() { events.push('tab'); if (mode === 'tab') throw cleanup; } } }),
        };
        if (name === '../tests/helpers/network') return { withTimeout: promise => promise };
        if (name === './lib/verify-refresh-coverage') return { verifyRefreshCoverage: async ({ onPeer, visit }) => {
            onPeer(peer); await visit('unit-url'); throw primary;
        } };
        return nativeRequire(name);
    };
    requireBoundary.resolve = nativeRequire.resolve;
    const context = { require: requireBoundary, module: { exports: {} }, __dirname: path.dirname(filename),
        process: { env: {} }, URL, console };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    const result = await context.module.exports.runBrowserChecks({ mode: 'refresh', coverage: {}, run: {} }).catch(error => error);
    expect(require('node:util').types.isNativeError(result)).toBe(true);
    expect(events).toEqual(expect.arrayContaining(['tab', 'peer', 'stop']));
    const leaves = error => Array.isArray(error.errors) ? error.errors.flatMap(leaves) : [error];
    expect(leaves(result).some(error => error === primary || error.cause === primary)).toBe(true);
    if (!Object.hasOwn(failures, mode)) {
        expect(leaves(result)).toContain(cleanup);
        expect(execution.cleanupFailure).toBeDefined();
    }
    if (['stderr', 'unref'].includes(mode)) expect(events).toContain('unref');
});
