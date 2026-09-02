'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { isNativeError } = require('node:util/types');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const filename = path.resolve(__dirname, '../../scripts/verify-development-refresh-browser.js');
const source = fs.readFileSync(filename, 'utf8');
const leaves = error => Array.isArray(error?.errors) ? error.errors.flatMap(leaves) : [error];

test('refresh assertions follow wrapper-free counter markup with null-safe lookups', () => {
    expect(source).toContain(`document.querySelector("button[rw-click]")?.textContent.trim() === "Count 1"`);
    expect(source).toContain(`document.querySelector("button[rw-click]")?.textContent.trim() === "Count 0"`);
    expect(source).not.toContain(`document.querySelector("output").textContent`);
});

// Explicit dependency-boundary units. The native integration runs the unchanged
// generated watcher/browser workflow without these doubles.
function load(boundaries = {}, globals = {}, cli = false) {
    const nativeRequire = createRequire(filename);
    const requireBoundary = name => Object.hasOwn(boundaries, name) ? boundaries[name] : nativeRequire(name);
    requireBoundary.resolve = nativeRequire.resolve;
    const context = { require: requireBoundary, module: { exports: {} }, __dirname: path.dirname(filename),
        process, URL, AbortSignal, console, setTimeout, clearTimeout, ...globals };
    if (cli) requireBoundary.main = context.module;
    vm.runInNewContext(createInstrumenter().instrumentSync(fs.readFileSync(filename, 'utf8'), filename), context, { filename });
    return context;
}

function retain(context) {
    if (!process.argv.includes('--collectCoverageFrom=scripts/verify-development-refresh-browser.js')) return;
    const combined = createCoverageMap(globalThis.__coverage__ || {});
    combined.merge(context.__coverage__);
    globalThis.__coverage__ ||= {};
    globalThis.__coverage__[filename] = combined.fileCoverageFor(filename).toJSON();
}

test.each(['fetch-and-release', 'invalid-url', 'falsy-release'])('page cleanup retains every failure: %s', async mode => {
    const primary = new Error('HTTP close failed'), cleanup = new Error('socket release failed');
    let releases = 0;
    const context = load({}, { fetch: async () => {
        if (mode === 'fetch-and-release') throw primary;
        return { ok: true, text: async () => '' };
    } });
    const result = await context.closePage({ socket: {
        url: mode === 'invalid-url' ? 'not a URL' : 'ws://127.0.0.1:9222/devtools/page/unit',
        terminate() { releases++; if (mode === 'fetch-and-release') throw cleanup; if (mode === 'falsy-release') throw null; },
    } }, 9222).then(() => ({ passed: true }), error => ({ error }));
    expect(result.passed).toBeUndefined();
    expect(releases).toBe(1);
    expect(isNativeError(result.error)).toBe(true);
    if (mode === 'fetch-and-release') expect(leaves(result.error)).toEqual([primary, cleanup]);
    if (mode === 'falsy-release') expect(result.error.cause).toBeNull();
    retain(context);
});

test.each(['bind-error', 'close-error', 'close-and-unref'])('port reservation rejects native-boundary %s', async mode => {
    const primary = new Error(mode), release = new Error('port unref'), reservation = new EventEmitter();
    reservation.listening = false;
    reservation.listen = (_port, _host, callback) => {
        if (mode === 'bind-error') {
            // Fail explicitly instead of letting an unhandled fake error crash
            // the runner: the old implementation did not install this listener.
            expect(reservation.listenerCount('error')).toBeGreaterThan(0);
            reservation.emit('error', primary);
        } else { reservation.listening = true; callback(); }
    };
    reservation.address = () => ({ port: 12345 });
    reservation.close = callback => { reservation.listening = false; callback(mode.startsWith('close') ? primary : undefined); };
    reservation.unref = () => { if (mode === 'close-and-unref') throw release; };
    const context = load({ net: { createServer: () => reservation } });
    const owner = {};
    const result = await context.availablePort(owner).catch(error => error);
    expect(leaves(result)).toEqual(mode === 'close-and-unref' ? [primary, release] : [primary]);
    if (mode.startsWith('close')) expect(owner.cleanupFailure).toBe(result);
    retain(context);
});

test.each(['null-operation', 'null-stop', 'stdout-release', 'all-releases', 'page-close'])
('watcher cleanup preserves the primary error and attempts independent releases: %s', async mode => {
    const primary = mode === 'null-operation' ? null : new Error('page open failed');
    const stop = mode === 'null-stop' ? null : new Error('watcher stop failed');
    const failures = ['stdout', 'stderr', 'unref'].map(name => new Error(name));
    const events = [], watcher = new EventEmitter();
    for (const [index, name] of ['stdout', 'stderr'].entries()) watcher[name] = Object.assign(new EventEmitter(), {
        destroy() { events.push(name); if (mode === 'all-releases' || (mode === 'stdout-release' && index === 0)) throw failures[index]; },
    });
    watcher.unref = () => { events.push('unref'); if (mode === 'all-releases') throw failures[2]; };
    const reservation = new EventEmitter();
    reservation.listen = (_port, _host, callback) => { reservation.listening = true; callback(); };
    reservation.address = () => ({ port: 12345 });
    reservation.close = callback => { reservation.listening = false; callback(); };
    const nativeRequire = createRequire(filename);
    const open = async () => {
        if (mode !== 'page-close') throw primary;
        let evaluations = 0;
        return { evaluate: async () => { if (++evaluations === 1) return true; throw primary; }, socket: {
            url: 'ws://127.0.0.1:9222/devtools/page/unit', terminate() { throw failures[0]; },
        } };
    };
    const context = load({
        fs: { ...fs, mkdirSync() {}, symlinkSync() {}, writeFileSync() {}, readFileSync: () => 'A counter owned by the server</main>' },
        net: { createServer: () => reservation },
        '../src/cli/ProjectInitializer': class { initialize() {} },
        './evaluation/process': { npmEntrypoint: () => 'unit-npm', spawnManaged() {
            queueMicrotask(() => { watcher.stdout.emit('data', 'unit stdout'); watcher.stderr.emit('data', 'unit stderr'); watcher.emit('spawn'); }); return watcher;
        }, stopProcessTree: async () => { events.push('stop'); if (mode === 'null-operation') watcher.emit('close'); else throw stop; } },
        './verify-live-html-browser': { ...nativeRequire('./verify-live-html-browser'), openPage: open },
    }, { fetch: async () => ({ ok: true, text: async () => 'Generation one' }) });
    const owner = { directory: path.resolve('unit-refresh') };
    const result = await context.verifyTemplate(owner, 9222, 'realtime', open).catch(error => error);
    expect(isNativeError(result)).toBe(true);
    const operationCause = leaves(result)[0].cause;
    expect(leaves(result)[0].message).toContain('unit stdoutunit stderr');
    if (primary === null) expect(operationCause.cause).toBeNull();
    else expect(operationCause).toBe(primary);
    if (mode !== 'null-operation') {
        expect(events).toEqual(['stop', 'stdout', 'stderr', 'unref']);
        expect(isNativeError(owner.cleanupFailure)).toBe(true);
        const retained = leaves(result);
        expect(retained.some(error => error === stop || error.cause === stop)).toBe(true);
        for (const failure of mode === 'all-releases' ? failures : mode === 'stdout-release' ? failures.slice(0, 1) : []) expect(retained).toContain(failure);
        if (mode === 'page-close') expect(retained).toContain(failures[0]);
    }
    retain(context);
});

test('an expired readiness deadline rejects rather than silently accepting no checks', async () => {
    let clock = 0, checks = 0;
    const context = load({}, { Date: { now: () => (clock += 20001) } });
    await expect(context.until(() => { checks++; return true; }, 'unit deadline')).rejects.toThrow('Timed out: unit deadline');
    expect(checks).toBe(0);
    retain(context);
});

test('page-owner cleanup failure cannot prevent browser shutdown or replace the operation', async () => {
    const primary = new Error('template setup'), cleanup = new Error('page drain'), events = [], owner = { directory: 'unit-refresh' };
    const nativeRequire = createRequire(filename);
    const child = { exitCode: null, signalCode: null };
    const context = load({
        fs: { ...fs, existsSync: () => true, mkdirSync() {} },
        '../src/cli/ProjectInitializer': class { initialize() { throw primary; } },
        './lib/VerificationWorkspace': { VerificationWorkspace: class { run(operation) { return operation(owner); } } },
        './lib/BrowserPages': { BrowserPages: class { async close() { events.push('pages'); throw cleanup; } } },
        './verify-live-html-browser': { ...nativeRequire('./verify-live-html-browser'), browserCandidates: ['unit-browser'],
            launchBrowserWithRetry: async () => ({ browser: { child }, endpoint: 'ws://127.0.0.1:9222/unit' }),
            stopBrowser: async () => { events.push('browser'); child.exitCode = 0; },
        },
    });
    const result = await context.module.exports.main().catch(error => error);
    expect(leaves(result)).toEqual([primary, cleanup]);
    expect(owner.cleanupFailure).toBe(cleanup);
    expect(events).toEqual(['pages', 'browser']);
    retain(context);
});

test('the CLI entrypoint reports rejection and sets a failing exit code', async () => {
    const errors = [], cliProcess = { env: {} };
    const context = load({ fs: { ...fs, existsSync: () => false },
        './lib/VerificationWorkspace': { VerificationWorkspace: class { run(operation) { return operation({}); } } },
    }, { process: cliProcess, console: { error(error) { errors.push(error); } } }, true);
    await new Promise(resolve => setImmediate(resolve));
    expect(cliProcess.exitCode).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Chromium is required');
    retain(context);
});

test.each([false, true])('a late browser opening remains owned through shutdown: unsettled=%p', async unsettled => {
    const primary = new Error('page opening deadline'), events = [], owner = { directory: 'unit-refresh' };
    let resolveOpening;
    const child = { exitCode: null, signalCode: null };
    const nativeRequire = createRequire(filename);
    const tab = { socket: { terminate() { events.push('release'); } } };
    const context = load({
        fs: { ...fs, existsSync: () => true, mkdirSync() {} },
        './lib/VerificationWorkspace': { VerificationWorkspace: class { run(operation) { return operation(owner); } } },
        '../tests/helpers/network': { withTimeout: (promise, label) => {
            if (label === 'browser page startup') { promise.catch(() => {}); return Promise.reject(primary); }
            if (label === 'pending browser page') {
                if (unsettled) return Promise.reject(new Error('pending opening deadline'));
                resolveOpening(tab);
            }
            return promise;
        } },
        './verify-live-html-browser': { ...nativeRequire('./verify-live-html-browser'), browserCandidates: ['unit-browser'],
            launchBrowserWithRetry: async () => ({ browser: { child }, endpoint: 'ws://127.0.0.1:9222/unit' }),
            openPage: () => new Promise(resolve => { resolveOpening = resolve; }),
            stopBrowser: async () => { events.push('stop'); child.exitCode = 0; if (unsettled) resolveOpening(tab); },
        },
    });
    // Isolate template work at its boundary, retaining the actual coordinator
    // and BrowserPages acquisition/drain implementation under test.
    context.verifyTemplate = async (_owner, port, _template, open) => open(port, 'about:blank');
    const result = await context.module.exports.main().catch(error => error);
    expect(leaves(result)).toContain(primary);
    expect(events).toEqual(unsettled ? ['stop', 'release'] : ['release', 'stop']);
    if (unsettled) expect(owner.cleanupFailure.message).toContain('did not settle');
    else expect(owner.cleanupFailure).toBeUndefined();
    retain(context);
});
