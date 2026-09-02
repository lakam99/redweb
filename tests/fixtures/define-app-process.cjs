'use strict';

const { defineApp } = require('../..');
const mode = process.argv[2];
const initial = ['SIGINT', 'SIGTERM'].map(name => process.listenerCount(name));
let disposed = 0;
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
            final: ['SIGINT', 'SIGTERM'].map(name => process.listenerCount(name)), listening: app.server.listening })));
    }
}
const app = defineApp({ port: 0, bind: '127.0.0.1', logger: null, services: [Resource],
    startupTimeoutMs: 2000, shutdownTimeoutMs: 100 });
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
    if (mode !== 'pending' || !error.message.includes('cancelled')) {
        console.error(error);
        process.exitCode = 1;
        if (process.connected) process.disconnect();
    }
});
