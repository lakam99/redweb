const WebSocket = require('ws');

const silentLogger = Object.freeze({ log() {}, warn() {}, error() {} });

function waitFor(emitter, event, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        let timer;
        const cleanup = () => {
            clearTimeout(timer);
            emitter.off(event, onEvent);
            emitter.off('error', onError);
        };
        const onEvent = (...args) => { cleanup(); resolve(args); };
        const onError = error => { cleanup(); reject(error); };
        timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${event}.`)); }, timeoutMs);
        timer.unref?.();
        emitter.once(event, onEvent);
        emitter.once('error', onError);
    });
}

async function openClient(url) {
    const socket = new WebSocket(url);
    await waitFor(socket, 'open');
    return socket;
}

async function closeClient(socket) {
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    const closed = waitFor(socket, 'close').catch(() => {});
    socket.close();
    await closed;
    if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
}

module.exports = { WebSocket, silentLogger, waitFor, openClient, closeClient };
