'use strict';

const { defineApp, SocketService } = require('../..');

test.each([null, false, [], 'app'])('rejects invalid application options %p before acquiring resources', options => {
    expect(() => defineApp(options)).toThrow('options must be an object');
});

test.each([
    { pages: [1] }, { sockets: {} }, { services: null }, { port: -1 }, { bind: '' },
    { startupTimeoutMs: 0 }, { startupTimeoutMs: 0.5 }, { shutdownTimeoutMs: 2147483648 },
    { signals: 'yes' }, { listen: false }, { routes: [] }, { socketRoutes: [] }, { closeServerOnShutdown: true },
    { services: [SocketService] }, { services: [class Timer extends SocketService {}] },
])('rejects ambiguous or invalid definition %p', options => {
    expect(() => defineApp(options)).toThrow();
});

test('definition copies registration arrays and neither constructs classes nor installs process handlers', async () => {
    let constructed = 0;
    class Resource { constructor() { constructed++; } }
    const before = ['SIGINT', 'SIGTERM'].map(event => process.listenerCount(event));
    const services = [Resource];
    const app = defineApp({ services });
    services.length = 0;
    expect(app.options.services).toEqual([Resource]);
    expect(constructed).toBe(0);
    expect(['SIGINT', 'SIGTERM'].map(event => process.listenerCount(event))).toEqual(before);
    await app.shutdown();
    await expect(app.run()).rejects.toThrow('cannot run after shutdown');
});

const config = { port: 0, bind: '127.0.0.1', logger: null, signals: false, startupTimeoutMs: 30, shutdownTimeoutMs: 30 };

test('bounds an uncooperative initializer and still calls its cleanup', async () => {
    let closed = false;
    class Pending { onInit() { return new Promise(() => {}); } onShutdown() { closed = true; } }
    const app = defineApp({ ...config, services: [Pending] });
    await expect(app.run()).rejects.toThrow('initialization exceeded its deadline');
    expect(closed).toBe(true);
    expect(app.server.listening).toBe(false);
});

test('retains initialization and cleanup failures without skipping earlier services', async () => {
    const calls = [];
    class First { onInit() {} onShutdown() { calls.push('first'); } }
    class Fails { onInit() { throw new Error('primary'); } onShutdown() { calls.push('failed'); throw new Error('cleanup'); } }
    const app = defineApp({ ...config, services: [First, Fails] });
    const error = await app.run().catch(error => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.cause.message).toBe('primary');
    expect(error.errors[1].errors[0].errors[0].message).toBe('cleanup');
    expect(calls).toEqual(['failed', 'first']);
    await expect(app.shutdown()).rejects.toThrow('shutdown failed');
});

test('invalid service shape fails initialization while cleaning its acquired instance', async () => {
    let closed = false;
    class Invalid { onShutdown() { closed = true; } }
    const app = defineApp({ ...config, services: [Invalid] });
    await expect(app.run()).rejects.toThrow('services require');
    expect(closed).toBe(true);
});

test('successful listener callback runs after binding; a callback failure unwinds the listener', async () => {
    let called = false;
    const app = defineApp({ ...config, listenCallback() { called = app.server.listening; throw new Error('callback failed'); } });
    await expect(app.run()).rejects.toThrow('callback failed');
    expect(called).toBe(true);
    expect(app.server.listening).toBe(false);
});

test('default signal ownership is acquired by run and removed by explicit shutdown', async () => {
    const before = ['SIGINT', 'SIGTERM'].map(event => process.listenerCount(event));
    const logs = [];
    const app = defineApp({ ...config, signals: true, logger: { log: message => logs.push(message) } });
    await app.run();
    expect(['SIGINT', 'SIGTERM'].map(event => process.listenerCount(event))).toEqual(before.map(count => count + 1));
    expect(logs[0]).toContain(String(app.server.address().port));
    await app.shutdown();
    expect(['SIGINT', 'SIGTERM'].map(event => process.listenerCount(event))).toEqual(before);
});
