'use strict';

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

// Explicit coordinator fault boundaries. Real command/transport tests do not use
// these replacements; the fake clock only avoids an hour per unit failure path.
test.each(['pass', 'already-listening', 'missing-gc', 'start-error', 'listen-error', 'open-error', 'construct-error',
    'traffic-error', 'sample-error', 'rotation-error', 'slow-rotation', 'terminal-rotation', 'drain-timeout',
    'close-error', 'shutdown-error', 'combined-error', 'file-error', 'failed-gate', 'write-file',
    'no-runtime', 'no-queue', 'no-owned-timers', 'queued-drain', 'same-failure'])
('soak coordinator preserves %s and independently attempts cleanup', async mode => {
    const environment = process.env, argv = process.argv, gc = global.gc, exitCode = process.exitCode;
    const events = [], failures = [], sent = [], rotations = [];
    const primary = new Error('unit primary soak error');
    let completed = false, sampleReads = 0, clockStart, clients, capturedOptions;
    const peer = new EventEmitter(); peer.on('message', () => {});
    peer.__redwebRuntime = mode === 'no-runtime' ? undefined : mode === 'no-queue' ? {} : { queue: { pending: mode === 'queued-drain' ? 1 : 0 } };
    const route = { clients: new Map([['unit', peer]]), rooms: new Map(), sessions: new Map(), inFlight: new Map(),
        runtime: mode === 'no-owned-timers' ? {} : { heartbeat: { timer: {} }, sessions: { timer: {} } } };
    if (mode === 'drain-timeout') route.inFlight.set('pending', {});
    class BaseHandler { constructor(type) { this.type = type; } }
    class SocketRoute {
        constructor(options) {
            capturedOptions = options;
            const handler = new options.handlers[0]();
            expect(handler.type).toBe('cycle');
            handler.onMessage({ joinRoom: room => events.push(room), createSession: (id, data) => events.push([id, data]),
                sendJson: value => events.push(value) }, { slot: 9, generation: 2, tick: 3 });
        }
    }
    const shutdown = jest.fn(async () => { events.push('shutdown'); if (['shutdown-error', 'combined-error'].includes(mode)) throw new Error('unit shutdown error'); });
    class SocketServer {
        constructor(options) {
            if (mode === 'start-error') throw primary;
            new options.routes[0]();
            this.routes = [route]; this.server = { listening: mode === 'already-listening', address: () => ({ port: 1 }) };
            this.shutdown = shutdown;
        }
    }
    class SoakClients {
        constructor(_url, _count, onFailure) {
            if (mode === 'construct-error') throw primary;
            clients = this; this.sent = 100; this.received = 100; this.onFailure = onFailure;
        }
        async openInitial() { if (mode === 'open-error') throw primary; }
        check() {}
        sendTick(tick) {
            sent.push(tick);
            if (['traffic-error', 'combined-error'].includes(mode)) throw primary;
            if (mode === 'same-failure') { this.onFailure(primary); this.onFailure(primary); }
        }
        async rotate(slot, stopped) {
            if (mode === 'rotation-error') throw primary;
            if (mode === 'slow-rotation' || mode === 'terminal-rotation') await new Promise(resolve => setTimeout(resolve, mode === 'slow-rotation' ? 1500 : 11000));
            rotations.push([slot, stopped()]);
        }
        async closeAll() {
            events.push('close');
            if (mode === 'close-error') throw primary;
            route.clients.clear(); route.inFlight.clear();
        }
    }
    jest.useFakeTimers({ doNotFake: ['hrtime', 'performance', 'nextTick', 'queueMicrotask'] });
    jest.setSystemTime(0); clockStart = Date.now();
    const memory = jest.spyOn(process, 'memoryUsage').mockImplementation(() => {
        sampleReads++;
        if (mode === 'sample-error' && sampleReads === 2) throw primary;
        return { heapUsed: 1000 };
    });
    const handles = jest.spyOn(process, '_getActiveHandles').mockReturnValue([]);
    const write = jest.spyOn(process.stdout, 'write').mockImplementation(value => { events.push('output'); completed = true; sent.result = JSON.parse(value); return true; });
    const error = jest.spyOn(process.stderr, 'write').mockImplementation(value => { failures.push(value); completed = true; return true; });
    const file = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => { events.push('file'); if (mode === 'file-error') throw new Error('unit file error'); });
    try {
        process.env = { REDWEB_SOAK_SECONDS: '10', REDWEB_SOAK_CLIENTS: '2', REDWEB_SOAK_SAMPLE_SECONDS: '1' };
        process.argv = ['node', 'soak', ...(['write-file', 'file-error'].includes(mode) ? [path.resolve('coverage/unit-soak.json')] : [])];
        global.gc = mode === 'missing-gc' ? undefined : () => events.push('gc');
        process.exitCode = 0;
        if (mode === 'queued-drain') setTimeout(() => { peer.__redwebRuntime.queue.pending = 0; }, 10500);
        jest.isolateModules(() => {
            jest.doMock('node:perf_hooks', () => ({ performance: { now: () => Date.now() - clockStart } }));
            jest.doMock('../..', () => ({ SocketServer, SocketRoute, BaseHandler }));
            jest.doMock('../../scripts/lib/SoakClients', () => ({ SoakClients }));
            jest.doMock('../../scripts/realtime-harness', () => ({ silentLogger: {}, waitFor: async () => { if (mode === 'listen-error') throw primary; } }));
            if (mode === 'failed-gate') {
                const { SoakMeasurement } = jest.requireActual('../../scripts/lib/SoakMeasurement');
                jest.doMock('../../scripts/lib/SoakMeasurement', () => ({ SoakMeasurement: class extends SoakMeasurement { passed() { return false; } } }));
            }
            require('../../scripts/verify-soak');
        });
        await jest.runAllTimersAsync();
        expect(completed).toBe(true);
        const passed = ['pass', 'already-listening', 'slow-rotation', 'terminal-rotation', 'write-file', 'no-runtime', 'no-queue', 'no-owned-timers', 'queued-drain'].includes(mode);
        expect(process.exitCode).toBe(passed ? 0 : 1);
        if (passed || mode === 'failed-gate') {
            expect(failures).toEqual([]); expect(sent.result.messagesReceived).toBe(100);
            expect(events.indexOf('output')).toBeGreaterThan(events.indexOf('shutdown'));
            expect(capturedOptions.limits.maxConnections).toBe(4); expect(capturedOptions.sessions.maxSessions).toBe(16);
            expect(events).toContainEqual(['session-2-9', { tick: 3 }]); expect(events).toContain('room-1');
        } else expect(write).not.toHaveBeenCalled();
        if (!['missing-gc', 'start-error'].includes(mode)) expect(shutdown).toHaveBeenCalledTimes(1);
        if (clients) expect(events).toContain('close');
        if (mode === 'combined-error') { expect(failures[0]).toContain('unit primary'); expect(failures[0]).toContain('unit shutdown'); }
        if (mode === 'terminal-rotation') expect(rotations.some(([, stopped]) => stopped)).toBe(true);
        if (mode === 'rotation-error' || mode === 'traffic-error') expect(Date.now()).toBeLessThan(10000);
        expect(jest.getTimerCount()).toBe(0);
    } finally {
        process.env = environment; process.argv = argv; global.gc = gc; process.exitCode = exitCode;
        memory.mockRestore(); handles.mockRestore(); write.mockRestore(); error.mockRestore(); file.mockRestore();
        jest.useRealTimers();
        for (const name of ['node:perf_hooks', '../..', '../../scripts/lib/SoakClients', '../../scripts/realtime-harness', '../../scripts/lib/SoakMeasurement']) jest.dontMock(name);
    }
});
