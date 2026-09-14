'use strict';

const { withTimeout } = require('../helpers/network');

// Explicit coordinator boundary units, not native integration. Real default
// CLI/HTTP/WebSocket checks live in live-html-load-tools.integration.test.js.
test.each(['pass', 'already-listening', 'missing-gc', 'start-error', 'listen-error', 'http-error', 'pending-count',
    'pending-timeout', 'construct-error', 'connect-error', 'client-error', 'initial-timeout', 'join-error',
    'presence-timeout', 'presence-cap', 'broadcast-timeout', 'close-error', 'late-error', 'active-timeout',
    'heap-over', 'shutdown-error', 'combined-error', 'join-and-patch-error'])
('HTML load command preserves %s, workload and cleanup boundaries', async mode => {
    const originalGc = global.gc, exitCode = process.exitCode;
    const records = [], events = [];
    let pageCount = 0, pendingReads = 0, memoryReads = 0, finish;
    const done = new Promise(resolve => { finish = resolve; });
    const primary = new Error('unit primary failure');
    const gc = jest.fn();
    const log = jest.spyOn(console, 'log').mockImplementation(value => { events.push('success'); finish(value); });
    const errorLog = jest.spyOn(console, 'error').mockImplementation(value => { events.push('failure'); finish(value); });
    const memory = jest.spyOn(process, 'memoryUsage').mockImplementation(() => ({ heapUsed: memoryReads++ === 0 ? 100 : mode === 'heap-over' ? 100 + 32 * 1024 * 1024 : 101 }));
    const clock = mode.endsWith('timeout') ? jest.spyOn(Date, 'now').mockImplementation((() => { let now = 0; return () => (now += 5000); })()) : undefined;
    const shutdown = jest.fn(async () => { events.push('shutdown'); if (['shutdown-error', 'combined-error'].includes(mode)) throw new Error('unit shutdown failure'); });
    const server = {
        server: { listening: mode === 'already-listening', address: () => ({ port: 1 }) }, shutdown,
        manager: {
            pending: { get size() { pendingReads++; return mode === 'pending-count' ? 0 : mode === 'pending-timeout' || pendingReads <= 2 ? 200 : 0; } },
            active: { get size() { return mode === 'active-timeout' ? 1 : 0; } },
        },
    };
    const start = jest.fn(() => { if (mode === 'start-error') throw primary; return server; });
    const getPage = jest.fn(async () => { pageCount++; if (mode === 'http-error' && pageCount === 1) throw primary; return {}; });
    class Client {
        constructor(_port, _config, updates) {
            if (mode === 'construct-error' && records.length === 3) throw primary;
            this.updates = updates; this.closed = false; records.push(this);
            this.client = {
                request: async () => {
                    if (mode === 'join-and-patch-error' && records[0] === this) {
                        this.failure = new Error('unit malformed patch'); throw primary;
                    }
                    if (mode === 'join-error') throw primary;
                    if (mode !== 'presence-timeout') updates.push({ html: `Online · 110 ${mode === 'presence-cap' ? '' : '+10 more'}` });
                },
                send: () => { if (mode !== 'broadcast-timeout') records.forEach(record => record.updates.push({ html: 'ordered-broadcast' })); },
            };
        }
        async connect() {
            if (mode === 'connect-error') throw primary;
            if (mode !== 'initial-timeout') this.updates.push({ html: 'initial' });
        }
        check() {
            if (mode === 'client-error' || mode === 'late-error' && this.closed) { this.failure = primary; throw primary; }
        }
        async close() {
            events.push('close'); this.closed = true;
            if (records[0] === this && ['close-error', 'combined-error'].includes(mode)) throw primary;
        }
    }
    try {
        global.gc = mode === 'missing-gc' ? undefined : gc;
        process.exitCode = 0;
        jest.isolateModules(() => {
            jest.doMock('../..', () => ({ start }));
            jest.doMock('../../examples/live-html/chatroom', () => ({ createChatroomPage: () => ({}) }));
            jest.doMock('../../scripts/lib/readLiveHtmlPage', () => ({ readLiveHtmlPage: getPage }));
            jest.doMock('../../scripts/lib/LiveHtmlLoadClient', () => ({ LiveHtmlLoadClient: Client }));
            jest.doMock('../../scripts/realtime-harness', () => ({ silentLogger: {}, waitFor: async () => { if (mode === 'listen-error') throw primary; } }));
            require('../../scripts/verify-live-html-load');
        });
        const output = await withTimeout(done, 'unit HTML load command', 2000);
        const passed = ['pass', 'already-listening'].includes(mode);
        expect(process.exitCode).toBe(passed ? 0 : 1);
        if (passed) {
            expect(output).toContain('200 expired renders, 110 live clients, heap delta 1 bytes.');
            expect(pageCount).toBe(310); expect(records).toHaveLength(110); expect(gc).toHaveBeenCalledTimes(3);
            expect(errorLog).not.toHaveBeenCalled(); expect(events.at(-2)).toBe('shutdown');
        } else {
            expect(log).not.toHaveBeenCalled();
            if (mode === 'combined-error') { expect(output).toContain('unit primary failure'); expect(output).toContain('unit shutdown failure'); }
            if (mode === 'join-and-patch-error') { expect(output).toContain('unit primary failure'); expect(output).toContain('unit malformed patch'); }
        }
        if (!['missing-gc', 'start-error'].includes(mode)) {
            expect(shutdown).toHaveBeenCalledTimes(1);
            expect(records.every(record => record.closed)).toBe(true);
        }
        if (mode === 'missing-gc') expect(start).not.toHaveBeenCalled();
    } finally {
        global.gc = originalGc; process.exitCode = exitCode;
        log.mockRestore(); errorLog.mockRestore(); memory.mockRestore(); clock?.mockRestore();
        for (const name of ['../..', '../../examples/live-html/chatroom', '../../scripts/lib/readLiveHtmlPage',
            '../../scripts/lib/LiveHtmlLoadClient', '../../scripts/realtime-harness']) jest.dontMock(name);
    }
});
