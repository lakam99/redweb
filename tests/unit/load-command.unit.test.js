'use strict';

const { withTimeout } = require('../helpers/network');

// Explicit unit substitutions isolate coordinator cleanup/aggregation. Real
// CLI integration separately executes the actual server, peers and probe.
test.each(['pass', 'over-budget', 'not-listening', 'listen-error', 'open-error', 'traffic-error',
    'probe-error', 'resume-error', 'close-error', 'shutdown-error', 'combined-error', 'missing-slow', 'uncontained-slow', 'still-open-slow'])
('load coordinator preserves %s and attempts every owned cleanup', async outcome => {
    const environment = process.env, exitCode = process.exitCode;
    const events = [], peers = [];
    let finish;
    const completed = new Promise(resolve => { finish = resolve; });
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => { events.push('output'); finish(); return true; });
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => { finish(); return true; });
    const shutdown = jest.fn(async () => {
        events.push('shutdown');
        if (['shutdown-error', 'combined-error'].includes(outcome)) throw new Error('unit shutdown');
    });
    const closeClient = jest.fn(async peer => {
        if (!peer) return;
        events.push('close');
        if (['close-error', 'combined-error'].includes(outcome)) throw new Error('unit close');
    });
    let opens = 0;
    const openClient = jest.fn(async () => {
        const index = opens++;
        if (index === 0 && ['open-error', 'combined-error'].includes(outcome)) throw new Error('unit open');
        // A later successful open must still be owned after an earlier failure.
        await new Promise(resolve => setImmediate(resolve));
        const peer = { send: jest.fn(), _socket: {
            pause() { if (outcome === 'probe-error') throw new Error('unit probe'); },
            resume() { if (outcome === 'resume-error') throw new Error('unit resume'); },
        } };
        peers.push(peer); events.push('open'); return peer;
    });
    const traffic = jest.fn(async (_clients, _measurement, probe) => {
        if (outcome === 'traffic-error') throw new Error('unit traffic');
        return { clients: 2, messages: 2, p99Ms: outcome === 'over-budget' ? 251 : 1,
            messagesPerSecond: 1000, slowConsumerContained: await probe() };
    });
    try {
        process.env = { REDWEB_LOAD_CLIENTS: '2', REDWEB_LOAD_MESSAGES: '1' }; process.exitCode = 0;
        jest.isolateModules(() => {
            jest.doMock('../..', () => ({
                BaseHandler: class {},
                SocketRoute: class {
                    constructor({ handlers, limits }) {
                        expect(limits.maxConnections).toBe(4);
                        expect(limits.maxPendingMessages).toBe(2);
                        const sendJson = jest.fn(() => sendJson.mock.calls.length < 3);
                        const slow = { sendJson, readyState: outcome === 'still-open-slow' ? 1 : 3, OPEN: 1 };
                        new handlers[0]().onMessage({ sendJson: jest.fn() }, { id: 'unit' });
                        new handlers[1]().onMessage(slow);
                        if (outcome === 'uncontained-slow') slow.__slowConsumerSends = 4096;
                        this.clients = new Map(outcome === 'missing-slow' ? [] : [[0, slow]]);
                    }
                },
                SocketServer: class {
                    constructor({ routes }) {
                        this.routes = [new routes[0]()];
                        this.server = { listening: !['not-listening', 'listen-error'].includes(outcome), address: () => ({ port: 1 }) };
                    }
                    shutdown = shutdown;
                },
            }));
            jest.doMock('../../scripts/realtime-harness', () => ({ silentLogger: {}, openClient, closeClient,
                waitFor: async () => { if (outcome === 'listen-error') throw new Error('unit listen'); } }));
            jest.doMock('../../scripts/lib/measureLoadTraffic', () => ({ measureLoadTraffic: traffic }));
            require('../../scripts/verify-load');
        });
        await withTimeout(completed, 'unit load coordinator completion', 2000);
        expect(shutdown).toHaveBeenCalledTimes(1);
        expect(closeClient.mock.calls.filter(([peer]) => peer).length).toBe(peers.length);
        expect(events.indexOf('shutdown')).toBeGreaterThan(events.lastIndexOf('close'));
        if (['pass', 'over-budget', 'not-listening', 'missing-slow', 'uncontained-slow', 'still-open-slow'].includes(outcome)) {
            expect(stderr).not.toHaveBeenCalled();
            expect(events.at(-1)).toBe('output');
            expect(process.exitCode).toBe(['pass', 'not-listening'].includes(outcome) ? 0 : 1);
        } else {
            expect(stdout).not.toHaveBeenCalled(); expect(process.exitCode).toBe(1);
            expect(stderr.mock.calls[0][0]).toContain('unit');
            if (outcome === 'combined-error') {
                expect(stderr.mock.calls[0][0]).toContain('unit open');
                expect(stderr.mock.calls[0][0]).toContain('unit close');
                expect(stderr.mock.calls[0][0]).toContain('unit shutdown');
            }
        }
        if (outcome === 'open-error') expect(events.indexOf('close')).toBeGreaterThan(events.lastIndexOf('open'));
    } finally {
        process.env = environment; process.exitCode = exitCode;
        stdout.mockRestore(); stderr.mockRestore();
        jest.dontMock('../..'); jest.dontMock('../../scripts/realtime-harness'); jest.dontMock('../../scripts/lib/measureLoadTraffic');
    }
});
