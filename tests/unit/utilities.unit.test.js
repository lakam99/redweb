const fs = require('fs');
const os = require('os');
const path = require('path');
const loadSslConfig = require('../../src/sslConfig');
const SocketRegistry = require('../../src/ws/SocketRegistry');
const SocketService = require('../../src/ws/SocketService');
const { BaseHandler } = require('../../src/ws/BaseHandler');
const { broadcast, canSend, sendJson } = require('../../src/ws/util');
const { closeWebSocketServer } = require('../../src/ws/shutdown');
const { settleTasks, throwCleanupErrors } = require('../../src/serverLifecycle');

describe('small reusable units', () => {
    test('loads TLS files and rejects incomplete configuration', () => {
        const key = path.join(__dirname, '..', 'fixtures', 'localhost.key');
        const cert = path.join(__dirname, '..', 'fixtures', 'localhost.crt');
        expect(loadSslConfig({ key, cert })).toEqual({
            key: fs.readFileSync(key),
            cert: fs.readFileSync(cert),
        });
        expect(() => loadSslConfig()).toThrow('SSL key and certificate paths must be provided');
        expect(() => loadSslConfig({ key })).toThrow('SSL key and certificate paths must be provided');
        expect(() => loadSslConfig({ cert })).toThrow('SSL key and certificate paths must be provided');
    });

    test('tracks registry items by reference or property and emits changes', () => {
        const registry = new SocketRegistry();
        const events = [];
        registry.on('added', item => events.push(['added', item.id]));
        registry.on('removed', item => events.push(['removed', item.id]));
        const first = { id: 'one', slug: 'first' };
        const second = { id: 'two', slug: 'second' };

        registry.add(first);
        registry.add(second);
        expect(registry.all()).toEqual([first, second]);
        expect(registry.all()).not.toBe(registry.items);
        expect(registry.count()).toBe(2);
        expect(registry.remove(first)).toBe(true);
        expect(registry.remove('second', 'slug')).toBe(true);
        expect(registry.remove('missing')).toBe(false);
        expect(events).toEqual([['added', 'one'], ['added', 'two'], ['removed', 'one'], ['removed', 'two']]);
    });

    test('sends only to open sockets and isolates broadcast send failures', () => {
        const sent = [];
        const open = { readyState: 1, send: value => sent.push(value) };
        const implicitOpen = { send: value => sent.push(value) };
        const instanceOpen = { readyState: 7, OPEN: 7, send: value => sent.push(value) };
        const closed = { readyState: 3, send: () => { throw new Error('must not send'); } };
        const failing = { readyState: 1, send: () => { throw new Error('closed concurrently'); } };

        expect(canSend()).toBe(false);
        expect(canSend({})).toBe(false);
        expect(canSend(closed)).toBe(false);
        expect(canSend(open)).toBe(true);
        expect(canSend(implicitOpen)).toBe(true);
        expect(canSend(instanceOpen)).toBe(true);
        expect(sendJson(closed, { no: true })).toBe(false);
        expect(sendJson(open, { ok: true })).toBe(true);
        expect(broadcast([open, closed, failing], { event: 'update' })).toBe(1);
        expect(sent).toEqual([
            JSON.stringify({ ok: true }),
            JSON.stringify({ event: 'update' }),
        ]);
    });

    test('enforces the BaseHandler contract and validation hook', async () => {
        const base = new BaseHandler('base');
        await expect(base.handleMessage({}, {})).rejects.toThrow('onMessage must be implemented');

        class InvalidHandler extends BaseHandler {
            constructor() { super('invalid'); }
            validateMessage() { return false; }
            onMessage() { throw new Error('must not run'); }
        }
        await expect(new InvalidHandler().handleMessage({}, {})).rejects.toThrow('Invalid message');

        const responses = [];
        await base.handleBinaryMessage({ sendJson: value => responses.push(value) }, Buffer.alloc(0));
        expect(responses).toEqual([{ error: 'Binary messages are not supported by this handler' }]);
        expect(base.onInitialContact({})).toBeUndefined();
    });

    test('keeps a service idle when no tick rate is configured', () => {
        const service = new SocketService('idle');
        service.onInit({});
        expect(service.tickRateMs).toBeNull();
        expect(service._tickHandle).toBeNull();
        service.onShutdown();
    });

    test('collects cleanup failures and reports them after all tasks run', async () => {
        const calls = [];
        const errors = await settleTasks([
            () => calls.push('first'),
            () => { throw new Error('sync cleanup failure'); },
            async () => { throw new Error('async cleanup failure'); },
            () => calls.push('last'),
        ]);
        expect(calls).toEqual(['first', 'last']);
        expect(errors.map(error => error.message)).toEqual(['sync cleanup failure', 'async cleanup failure']);
        expect(() => throwCleanupErrors(errors, 'cleanup failed')).toThrow('cleanup failed');
    });

    test('handles WebSocket-server close errors, throws, and termination failures', async () => {
        await expect(closeWebSocketServer({ close: callback => callback(new Error('close callback failed')) }, [], 50))
            .rejects.toThrow('close callback failed');
        await expect(closeWebSocketServer({ close: () => { throw new Error('close threw'); } }, [], 50))
            .rejects.toThrow('close threw');

        let lateCallback;
        const waitingServer = { close: callback => { lateCallback = callback; } };
        const terminated = [];
        await expect(closeWebSocketServer(waitingServer, [
            { terminate: () => terminated.push('terminated') },
            { terminate: () => { throw new Error('terminate failed'); } },
            {},
        ], 0)).rejects.toThrow('terminate failed');
        lateCallback();
        expect(terminated).toEqual(['terminated']);
    });
});
