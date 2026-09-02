'use strict';

const { defineApp, SocketService } = require('../..');

test.each([null, false, [], 'app'])('rejects invalid application options %p before acquiring resources', options => {
    expect(() => defineApp(options)).toThrow('options must be an object');
});

test.each([
    { pages: [1] }, { sockets: {} }, { services: null }, { port: -1 }, { bind: '' },
    { startupTimeoutMs: 0 }, { startupTimeoutMs: 0.5 }, { shutdownTimeoutMs: 2147483648 },
    { signals: 'yes' }, { listen: false }, { routes: [] }, { socketRoutes: [] }, { closeServerOnShutdown: true }, { static: true },
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

const config = { port: 0, bind: '127.0.0.1', logger: null, signals: false, startupTimeoutMs: 1000, shutdownTimeoutMs: 1000 };

test('bounds an uncooperative initializer and still calls its cleanup', async () => {
    let closed = false;
    class Pending { onInit() { return new Promise(() => {}); } onShutdown() { closed = true; } }
    const app = defineApp({ ...config, services: [Pending], startupTimeoutMs: 30 });
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

test('default definition is inert and can be disposed without binding the default port', async () => {
    const app = defineApp();
    expect(app.options.port).toBe(8181);
    expect(app.options.pages).toEqual([]);
    await app.shutdown();
});

test('immediate shutdown prevents a queued native listen from starting', async () => {
    const app = defineApp(config);
    const result = expect(app.run()).rejects.toThrow('cancelled');
    await app.shutdown();
    await result;
    expect(app.server.listening).toBe(false);
});

test('an expired startup budget does not invoke another startup operation', async () => {
    const app = defineApp(config);
    app._startupDeadline = 0;
    let invoked = false;
    await expect(app._withinStartup(() => { invoked = true; }, 'Next phase')).rejects.toThrow('deadline');
    await expect(app._listen()).rejects.toThrow('deadline');
    expect(invoked).toBe(false);
    await app.shutdown();
    expect(() => app._checkStarting()).toThrow('cancelled');
});

test('already cancelled startup never invokes queued work', async () => {
    const app = defineApp(config);
    app._startupDeadline = require('node:perf_hooks').performance.now() + 1000;
    app._abort.abort();
    let invoked = false;
    await expect(app._withinStartup(() => { invoked = true; }, 'Next phase')).rejects.toThrow('cancelled');
    expect(invoked).toBe(false);
    await app.shutdown();
});

test.each(['close', 'error', 'failed-cleanup'])('embedded applications own external listener termination: %s', async mode => {
    let closed = 0;
    class Resource {
        onInit() {}
        onShutdown() { closed++; if (mode === 'failed-cleanup') throw new Error('cleanup failed'); }
    }
    const app = defineApp({ ...config, services: [Resource] });
    await app.run();
    if (mode === 'error') app.server.emit('error', new Error('unit listener failure'));
    else {
        const closed = new Promise(resolve => app.server.once('close', resolve));
        app.server.close();
        await closed;
    }
    const result = app.shutdown();
    if (mode === 'failed-cleanup') await expect(result).rejects.toThrow('shutdown failed');
    else await result;
    expect(closed).toBe(1);
    expect(app.server.listening).toBe(false);
});

test.each([false, true])('disposal closes admission and retains native close failures: %s', async fail => {
    const app = defineApp(config);
    await app.run();
    const close = app.server.close;
    // A native close failure is a unit boundary fault, not an integration substitute.
    if (fail) app.server.close = () => { throw new Error('native close failed'); };
    try {
        const result = app._cleanup();
        if (fail) await expect(result).rejects.toThrow('shutdown failed');
        else await result;
    } finally {
        app.server.close = close;
        await app.shutdown().catch(() => {});
        if (app.server.listening) await new Promise(resolve => app.server.close(resolve));
    }
    expect(app.server.listening).toBe(false);
});

test.each(['listening', 'error', 'close-failure', 'deadline', 'synchronous-failure'])('abandoned native listener retains a terminal-event guard: %s', async mode => {
    // Unit-only fault boundary. Node 18/22 subprocess tests exercise the real
    // DNS and numeric-host cancellation paths without replacing native APIs.
    const { EventEmitter } = require('node:events');
    const server = new EventEmitter();
    let started = 0, closed = 0;
    server.listen = () => { started++; if (mode === 'synchronous-failure') throw new Error('native listen failed'); };
    server.close = () => { closed++; if (mode === 'close-failure') throw new Error('native close failed'); };
    const app = defineApp(config);
    app.server = server;
    app._startupDeadline = require('node:perf_hooks').performance.now() + (mode === 'deadline' ? 30 : 1000);
    const rejected = expect(app._listen()).rejects.toThrow(mode === 'deadline' ? 'deadline'
        : mode === 'synchronous-failure' ? 'native listen failed' : 'cancelled');
    await Promise.resolve();
    expect(started).toBe(1);
    if (mode !== 'deadline' && mode !== 'synchronous-failure') app._abort.abort();
    await rejected;
    if (mode === 'synchronous-failure') {
        expect(server.listenerCount('error')).toBe(0);
        expect(server.listenerCount('listening')).toBe(0);
        await app.shutdown();
        return;
    }
    expect(server.listenerCount('error')).toBe(1);
    // The outer run() failure handler aborts only after the deadline rejection.
    if (mode === 'deadline') app._abort.abort();
    if (mode === 'error') server.emit('error', new Error('late DNS failure'));
    else server.emit('listening');
    await Promise.resolve();
    expect(closed).toBe(mode === 'error' ? 0 : 1);
    expect(server.listenerCount('error')).toBe(0);
    expect(server.listenerCount('listening')).toBe(0);
    await app.shutdown();
});
