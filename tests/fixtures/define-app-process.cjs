'use strict';

const { defineApp } = require('../..');
const mode = process.argv[2];
const dnsCancellation = mode === 'dns-error' || mode === 'dns-success' || mode === 'numeric-cancel';
const initial = ['SIGINT', 'SIGTERM'].map(name => process.listenerCount(name));
let disposed = 0, lookupStarted = false;
class Resource {
    onInit() {
        if (mode === 'pending') {
            process.send({ ready: true });
            return new Promise(() => {});
        }
    }
    onShutdown() {
        disposed++;
        if (mode === 'leaked') {
            setInterval(() => {}, 100);
            throw new Error('deliberate failed cleanup');
        }
        setImmediate(() => console.log(JSON.stringify({ disposed, initial,
            final: ['SIGINT', 'SIGTERM'].map(name => process.listenerCount(name)), listening: app.server.listening, lookupStarted })));
    }
}
const bind = mode === 'dns-error' ? `redweb-${require('node:crypto').randomUUID()}.invalid`
    : mode === 'dns-success' ? 'localhost' : '127.0.0.1';
const app = defineApp({ port: 0, bind, logger: null, services: [Resource],
    startupTimeoutMs: 2000, shutdownTimeoutMs: 100 });
if (dnsCancellation) {
    const hook = require('node:async_hooks').createHook({ init(_id, type) {
        // Observe the actual native lookup (including Node 18's numeric-address
        // nextTick path), not a replaced DNS or server implementation.
        const lookup = mode === 'numeric-cancel'
            ? type === 'TickObject' && new Error().stack.includes('node:dns')
            : type === 'GETADDRINFOREQWRAP';
        if (lookup) {
            hook.disable();
            lookupStarted = true;
            queueMicrotask(() => { process.disconnect(); void app.shutdown(); });
        }
    } });
    hook.enable();
    process.once('beforeExit', () => {
        if (!lookupStarted || app.server.listening) process.exitCode = 1;
    });
}
process.on('message', message => {
    process.disconnect();
    if (message.action === 'close') app.server.close();
    else if (process.platform === 'win32') {
        // Windows child.kill cannot deliver POSIX signals; exercise the same real process handlers.
        process.emit(message.signal);
        process.emit(message.signal);
    } else process.kill(process.pid, message.signal);
});
app.run().then(() => { if (mode !== 'pending') process.send({ ready: true }); }).catch(error => {
    if ((!dnsCancellation && mode !== 'pending') || !error.message.includes('cancelled')) {
        console.error(error);
        process.exitCode = 1;
        if (process.connected) process.disconnect();
    }
});
