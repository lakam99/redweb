'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const filename = path.resolve(__dirname, '../../scripts/evaluation/process.js');

// Explicit platform/process boundary units. Actual builds, descendant cleanup,
// listener inspection and evidence sealing are exercised without API doubles.
async function unit(options, operation) {
    const calls = [], failure = Object.assign(new Error('unit operating-system failure'), { code: options.code });
    const child = Object.assign(new EventEmitter(), { pid: options.noPid ? undefined : 12345, exitCode: null, signalCode: null,
        stdout: new EventEmitter(), stderr: new EventEmitter() });
    const nativeRequire = createRequire(filename);
    const requireBoundary = name => {
        if (name === 'fs') return { existsSync: candidate => options.npm === undefined || candidate === options.npm };
        if (name === 'child_process') return {
            spawn(executable, args, config) {
                calls.push({ executable, args, config });
                if (executable === 'taskkill.exe') {
                    const killer = new EventEmitter();
                    queueMicrotask(() => {
                        if (options.killerError) killer.emit('error', failure);
                        else { killer.emit('close', 0); child.emit('exit', 0); }
                    });
                    return killer;
                }
                if (options.noPid) queueMicrotask(() => child.emit('error', failure));
                return child;
            },
            execFileSync(executable, args, config) {
                calls.push({ executable, args, config });
                return JSON.stringify(options.addresses);
            },
        };
        return nativeRequire(name);
    };
    const context = { require: requireBoundary, module: { exports: {} }, __dirname: path.dirname(filename),
        process: { platform: options.platform || 'win32', execPath: '/unit/node', env: { npm_execpath: options.envNpm },
            kill(pid, signal) {
                calls.push({ pid, signal });
                if (options.code !== 'EPERM') queueMicrotask(() => child.emit('exit', 0));
                if (options.code) throw failure;
            } },
    };
    vm.runInNewContext(createInstrumenter().instrumentSync(fs.readFileSync(filename, 'utf8'), filename), context, { filename });
    try { await operation(context.module.exports, { child, calls, failure }); }
    finally {
        if (process.argv.includes('--collectCoverageFrom=scripts/evaluation/process.js')) {
            const map = createCoverageMap(globalThis.__coverage__ || {}); map.merge(context.__coverage__);
            globalThis.__coverage__ ||= {}; globalThis.__coverage__[filename] = map.fileCoverageFor(filename).toJSON();
        }
    }
}

test('npm discovery fails explicitly when every candidate is absent', () => unit({ npm: 'missing' }, api => {
    expect(() => api.npmEntrypoint()).toThrow('Cannot locate npm-cli.js');
}));

test('npm discovery honors the explicit npm entrypoint', () => unit({ envNpm: '/unit/npm.js', npm: '/unit/npm.js' }, api => {
    expect(api.npmEntrypoint()).toBe('/unit/npm.js');
}));

test('a failed launch without a PID reports the original error without attempting a kill', () => unit({ noPid: true }, async (api, { calls, failure }) => {
    const report = await api.runBuild('unit-build');
    expect(report.error).toBe(failure.message);
    expect(report.exitCode).toBeNull();
    expect(Date.parse(report.endedAt)).toBeGreaterThanOrEqual(Date.parse(report.startedAt));
    expect(calls).toHaveLength(1);
}));

test.each([undefined, null, { pid: 0 }, { pid: 1, exitCode: 0, signalCode: null }, { pid: 1, exitCode: null, signalCode: 'SIGTERM' }])
('already absent or exited process is not signalled: %p', child => unit({}, async (api, { calls }) => {
    await api.stopProcessTree(child);
    expect(calls).toEqual([]);
}));

test.each([undefined, 'ESRCH', 'EPERM'])('POSIX process group cleanup handles %p without changing its policy', code => unit({ platform: 'linux', code }, async (api, { child, calls, failure }) => {
    if (code === 'EPERM') await expect(api.stopProcessTree(child)).rejects.toBe(failure);
    else await api.stopProcessTree(child);
    expect(calls).toEqual([{ pid: -child.pid, signal: 'SIGKILL' }]);
}));

test.each([false, true])('Windows tree-cleaner launch error=%p remains observable', killerError => unit({ killerError }, async (api, { child, calls, failure }) => {
    if (killerError) await expect(api.stopProcessTree(child)).rejects.toBe(failure);
    else await api.stopProcessTree(child);
    expect(calls[0].executable).toBe('taskkill.exe');
    expect(calls[0].args).toEqual(['/PID', String(child.pid), '/T', '/F']);
    expect(calls[0].config.windowsHide).toBe(true);
}));

test.each(['win32', 'linux'])('managed %s children keep the expected process-group settings', platform => unit({ platform }, (api, { child, calls }) => {
    expect(api.spawnManaged(['unit.js'], { cwd: 'unit-dir' })).toBe(child);
    expect(calls[0].config).toEqual({ cwd: 'unit-dir', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: platform !== 'win32' });
}));

test.each([0, -1, 65536, 1.5, '12; exit'])('invalid port %p never invokes a shell', port => unit({}, (api, { calls }) => {
    expect(() => api.listenerAddresses(port)).toThrow('Invalid listener port');
    expect(calls).toEqual([]);
}));

test('non-Windows listener inspection fails explicitly', () => unit({ platform: 'linux' }, (api, { calls }) => {
    expect(() => api.listenerAddresses(12345)).toThrow('currently requires Windows');
    expect(calls).toEqual([]);
}));

test.each(['127.0.0.1', ['127.0.0.1', '::1']])('listener output normalizes only its scalar/array shape: %p', addresses => unit({ addresses }, (api, { calls }) => {
    expect(api.listenerAddresses(12345)).toEqual(Array.isArray(addresses) ? addresses : [addresses]);
    expect(calls).toHaveLength(1);
    expect(calls[0].executable).toBe('powershell.exe');
    expect(calls[0].args.at(-1)).toContain('-LocalPort 12345 -State Listen');
}));
