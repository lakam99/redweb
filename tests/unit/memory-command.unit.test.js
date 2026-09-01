'use strict';

// Explicit unit boundary substitution. The integration suite launches these
// exact commands with real processes, sockets, GC and the managed owner.
const { withTimeout } = require('../helpers/network');

test.each(['pass', 'over-budget', 'invalid-output', 'command-error', 'cleanup-error'])
('memory coordinator preserves %s and sequential worker ownership', async outcome => {
    const originalEnvironment = process.env;
    const originalExitCode = process.exitCode;
    let finish;
    const completed = new Promise(resolve => { finish = resolve; });
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => { finish(); return true; });
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => { finish(); return true; });
    const command = jest.fn(async args => {
        if (outcome === 'command-error') throw new Error('unit command error');
        if (outcome === 'invalid-output') return '{"invalid":true}';
        const mode = args[2], count = Number(args[3]);
        const bytesPerConnection = mode === 'enabled' ? outcome === 'over-budget' ? 4096 : 1024 : 0;
        return JSON.stringify({ mode, count, heapDelta: count * bytesPerConnection, bytesPerConnection });
    });
    const run = jest.fn(async operation => {
        const result = await operation({ command });
        if (outcome === 'cleanup-error') throw new Error('unit cleanup error');
        return result;
    });
    try {
        process.env = {};
        process.exitCode = 0;
        jest.isolateModules(() => {
            jest.doMock('../../scripts/lib/VerificationWorkspace', () => ({ VerificationWorkspace: class { run = run; } }));
            require('../../scripts/verify-memory-overhead');
        });
        await withTimeout(completed, 'unit coordinator completion', 1000);
        expect(process.exitCode).toBe(outcome === 'pass' ? 0 : 1);
        if (['pass', 'over-budget'].includes(outcome)) {
            expect(stderr).not.toHaveBeenCalled();
            expect(JSON.parse(stdout.mock.calls[0][0]).trials).toBe(3);
        } else {
            expect(stdout).not.toHaveBeenCalled();
            expect(stderr).toHaveBeenCalledTimes(1);
        }
        const modes = ['legacy', 'enabled', 'enabled', 'legacy', 'legacy', 'enabled'];
        expect(command.mock.calls.map(([args]) => args[2])).toEqual(modes.slice(0, command.mock.calls.length));
        for (const [args, options] of command.mock.calls) {
            expect(args[0]).toBe('--expose-gc'); expect(args[3]).toBe('500');
            expect(options.timeoutMs).toBe(60000);
            expect(options.rejectTruncatedOutput).toBe(true);
        }
    } finally {
        process.env = originalEnvironment;
        process.exitCode = originalExitCode;
        stdout.mockRestore(); stderr.mockRestore();
        jest.dontMock('../../scripts/lib/VerificationWorkspace');
    }
});

test.each([
    ...['legacy', 'context', 'transport', 'heartbeat', 'rooms', 'sessions', 'drain', 'protocol', 'enabled'].map(mode => ['success', mode]),
    ...['listen-failure', 'open-failure', 'socket-cleanup-failure', 'server-cleanup-failure', 'combined-failure', 'late-close'].map(outcome => [outcome, 'enabled']),
])('memory worker independently attempts owned cleanup after %s in %s mode', async (outcome, mode) => {
    const originalArgv = process.argv, originalGc = global.gc, originalExitCode = process.exitCode;
    let finish;
    const completed = new Promise(resolve => { finish = resolve; });
    const events = [], clients = [];
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => { events.push('output'); finish(); return true; });
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => { finish(); return true; });
    class Peer {
        static CLOSED = 3;
        constructor() { this.readyState = 1; clients.push(this); }
    }
    const shutdown = jest.fn(async () => {
        events.push('shutdown');
        if (['server-cleanup-failure', 'combined-failure'].includes(outcome)) throw new Error('unit server cleanup');
    });
    const closeClient = jest.fn(async client => {
        events.push('close');
        if (['socket-cleanup-failure', 'combined-failure'].includes(outcome)) throw new Error('unit socket cleanup');
        if (outcome !== 'late-close') client.readyState = Peer.CLOSED;
    });
    const waitFor = jest.fn(async (target, event) => {
        if (event === 'listening' && outcome === 'listen-failure') throw new Error('unit listen failure');
        if (event === 'open' && ['open-failure', 'combined-failure'].includes(outcome)) throw new Error('unit open failure');
        if (event === 'close') target.readyState = Peer.CLOSED;
    });
    try {
        process.argv = [process.execPath, 'memory-worker.js', mode, ...(outcome === 'success' ? [] : ['2'])];
        process.exitCode = 0; global.gc = jest.fn();
        jest.isolateModules(() => {
            jest.doMock('../..', () => ({
                BaseHandler: class {}, SocketRoute: class {
                    constructor({ handlers, admission }) {
                        handlers.forEach(Handler => new Handler().onMessage());
                        admission?.();
                    }
                },
                SocketServer: class {
                    constructor({ routes }) {
                        const route = new routes[0]();
                        // Real modes are covered by native integration; this unit exercises
                        // launcher/cleanup decisions and the otherwise idle handler callback.
                        void route;
                        this.server = { listening: outcome === 'success', address: () => ({ port: 1 }) };
                    }
                    shutdown = shutdown;
                },
            }));
            jest.doMock('../../scripts/realtime-harness', () => ({ WebSocket: Peer, silentLogger: {}, waitFor, closeClient }));
            require('../../scripts/memory-worker');
        });
        await withTimeout(completed, 'unit worker completion', 1000);
        expect(shutdown).toHaveBeenCalledTimes(1);
        expect(closeClient).toHaveBeenCalledTimes(clients.length);
        if (['success', 'late-close'].includes(outcome)) {
            expect(stderr).not.toHaveBeenCalled(); expect(process.exitCode).toBe(0);
            expect(events.at(-1)).toBe('output');
            expect(events.indexOf('shutdown')).toBeGreaterThan(events.lastIndexOf('close'));
        } else {
            expect(stdout).not.toHaveBeenCalled(); expect(process.exitCode).toBe(1);
            const message = stderr.mock.calls[0][0];
            expect(message).toContain(outcome === 'combined-failure' ? 'unit open failure' : 'unit');
            if (outcome === 'combined-failure') {
                expect(message).toContain('unit socket cleanup');
                expect(message).toContain('unit server cleanup');
            }
        }
    } finally {
        process.argv = originalArgv; process.exitCode = originalExitCode; global.gc = originalGc;
        stdout.mockRestore(); stderr.mockRestore();
        jest.dontMock('../..'); jest.dontMock('../../scripts/realtime-harness');
    }
});

test('memory worker fails before starting without explicit GC', () => {
    const argv = process.argv, gc = global.gc;
    try {
        process.argv = [process.execPath, 'memory-worker.js', 'legacy', '1'];
        global.gc = undefined;
        expect(() => jest.isolateModules(() => require('../../scripts/memory-worker'))).toThrow('--expose-gc');
    } finally { process.argv = argv; global.gc = gc; }
});
