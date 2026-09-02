const WebSocket = require('ws');
const { verificationError } = require('./lib/verificationError');

const silentLogger = Object.freeze({ log() {}, warn() {}, error() {} });

function waitFor(emitter, event, timeoutMs = 5000, start) {
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
        try { start?.(); } catch (error) { onError(error); }
    });
}

async function openClient(url) {
    const socket = new WebSocket(url);
    try {
        await waitFor(socket, 'open');
        return socket;
    } catch (error) {
        const primary = verificationError(error);
        try { await closeClient(socket); }
        catch (cleanup) { throw new AggregateError([primary, verificationError(cleanup)], primary.message, { cause: primary }); }
        throw primary;
    }
}

async function closeClient(socket) {
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    const failures = [];
    const attempt = method => waitFor(socket, 'close', 5000, () => {
        try { socket[method](); }
        catch (error) { failures.push(verificationError(error)); throw error; }
    }).catch(() => {});
    await attempt('close');
    if (socket.readyState !== WebSocket.CLOSED) {
        await attempt('terminate');
        if (socket.readyState !== WebSocket.CLOSED) failures.push(new Error('Socket did not close after termination.'));
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, failures[0].message, { cause: failures[0] });
}

module.exports = { WebSocket, silentLogger, waitFor, openClient, closeClient };
