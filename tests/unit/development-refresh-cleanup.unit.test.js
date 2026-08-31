'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { isNativeError } = require('node:util/types');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const filename = path.resolve(__dirname, '../../scripts/verify-development-refresh-browser.js');

// Explicit launch/process/filesystem boundary units, not native browser IT.
test.each(['missing-browser', 'mkdir', 'launch', 'launch-null', 'operation-null',
    'clean-stop', 'signal-stop', 'still-live', 'stop', 'stop-null', 'stop-pending',
    'stderr', 'unref', 'both-releases', 'missing-stderr'])
('development refresh preserves ownership and independent cleanup: %s', async mode => {
    const events = [], owner = { directory: 'unit-refresh-profile' };
    const primary = mode.endsWith('-null') && mode !== 'stop-null' ? null : new Error('unit refresh primary');
    const cleanup = new Error('unit refresh stop');
    const pipe = new Error('unit refresh stderr');
    const reference = new Error('unit refresh unref');
    const child = { exitCode: null, signalCode: null,
        stderr: { destroy() { events.push('stderr'); if (['stderr', 'both-releases'].includes(mode)) throw pipe; } },
        unref() { events.push('unref'); if (['unref', 'both-releases'].includes(mode)) throw reference; },
    };
    if (mode === 'missing-stderr') delete child.stderr;
    const nativeRequire = createRequire(filename);
    const requireBoundary = name => {
        if (name === 'fs') return { ...fs, existsSync: () => mode !== 'missing-browser',
            mkdirSync() { if (mode === 'mkdir') throw primary; } };
        if (name === './lib/VerificationWorkspace') return { VerificationWorkspace: class {
            run(operation) { return operation(owner); }
        } };
        if (name === '../src/cli/ProjectInitializer') return class {
            initialize() { events.push('operation'); throw primary; }
        };
        if (name === './verify-live-html-browser') return {
            browserCandidates: ['unit-chromium'],
            launchBrowserWithRetry: async () => {
                events.push('launch');
                if (mode.startsWith('launch')) throw primary;
                return { browser: { child }, endpoint: 'ws://127.0.0.1:9222/unit' };
            },
            stopBrowser: async () => {
                events.push('stop');
                if (mode === 'stop-pending') return new Promise(() => {});
                if (['stop', 'stop-null', 'stderr', 'unref', 'both-releases', 'missing-stderr'].includes(mode)) throw mode === 'stop-null' ? null : cleanup;
                if (mode === 'signal-stop') child.signalCode = 'SIGTERM';
                else if (mode !== 'still-live') child.exitCode = 0;
            },
            combineFailures: nativeRequire(name).combineFailures,
        };
        return nativeRequire(name);
    };
    requireBoundary.resolve = nativeRequire.resolve;
    const context = { require: requireBoundary, module: { exports: {} }, __dirname: path.dirname(filename),
        process: { env: {} }, URL, console };
    vm.runInNewContext(createInstrumenter().instrumentSync(fs.readFileSync(filename, 'utf8'), filename), context, { filename });
    const result = await context.module.exports.main().then(() => ({ passed: true }), error => ({ error }));
    expect(result.passed).toBeUndefined();
    expect(isNativeError(result.error)).toBe(true);
    const leaves = error => Array.isArray(error?.errors) ? error.errors.flatMap(leaves) : [error];
    const errors = leaves(result.error);
    if (mode !== 'missing-browser') expect(errors.some(error => error === primary || error.cause === primary)).toBe(true);
    if (['missing-browser', 'mkdir', 'clean-stop', 'signal-stop', 'operation-null'].includes(mode)) {
        expect(owner.cleanupFailure).toBeUndefined();
    } else {
        expect(isNativeError(owner.cleanupFailure)).toBe(true);
        if (!mode.startsWith('launch')) expect(events).toEqual(mode === 'missing-stderr'
            ? ['launch', 'operation', 'stop', 'unref'] : ['launch', 'operation', 'stop', 'stderr', 'unref']);
    }
    if (mode.startsWith('launch')) expect(events).toEqual(['launch']);
    if (['stop', 'stderr', 'unref', 'both-releases', 'missing-stderr'].includes(mode)) expect(errors).toContain(cleanup);
    if (mode === 'stop-pending') expect(errors.some(error => error.message.includes('development refresh browser shutdown'))).toBe(true);
    if (mode === 'stop-null') expect(errors.some(error => error.cause === null)).toBe(true);
    if (['stderr', 'both-releases'].includes(mode)) expect(errors).toContain(pipe);
    if (['unref', 'both-releases'].includes(mode)) expect(errors).toContain(reference);
    if (process.argv.includes('--collectCoverageFrom=scripts/verify-development-refresh-browser.js')) {
        const combined = createCoverageMap(globalThis.__coverage__ || {});
        combined.merge(context.__coverage__);
        globalThis.__coverage__ ||= {};
        globalThis.__coverage__[filename] = combined.fileCoverageFor(filename).toJSON();
    }
}, 45000); // Includes the actual 15-second shutdown watchdog in the pending unit.
