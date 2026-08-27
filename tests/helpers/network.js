const http = require('http');
const https = require('https');

const silentLogger = Object.freeze({ log() {}, warn() {}, error() {} });

function withTimeout(promise, label, timeoutMs = 3000) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
        }),
    ]).finally(() => clearTimeout(timer));
}

function waitForListening(server) {
    if (server.listening) return Promise.resolve();
    return withTimeout(new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    }), 'server to listen');
}

function request({ protocol = 'http:', host = '127.0.0.1', port, path = '/', method = 'GET', headers = {}, body }) {
    const transport = protocol === 'https:' ? https : http;
    return withTimeout(new Promise((resolve, reject) => {
        const req = transport.request({
            protocol,
            host,
            port,
            path,
            method,
            headers,
            rejectUnauthorized: false,
        }, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve({
                status: res.statusCode,
                headers: res.headers,
                body: Buffer.concat(chunks).toString('utf8'),
            }));
        });
        req.once('error', reject);
        if (body !== undefined) req.write(body);
        req.end();
    }), `${method} ${path}`);
}

function waitForOpen(socket) {
    if (socket.readyState === socket.OPEN) return Promise.resolve();
    return withTimeout(new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
    }), 'WebSocket to open');
}

function nextMessage(socket) {
    return withTimeout(new Promise((resolve, reject) => {
        socket.once('message', (data, isBinary) => resolve({ data, isBinary }));
        socket.once('error', reject);
    }), 'WebSocket message');
}

function waitForClose(socket) {
    if (socket.readyState === socket.CLOSED) return Promise.resolve({ code: 1005, reason: '' });
    return withTimeout(new Promise((resolve) => {
        socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    }), 'WebSocket close');
}

async function closeWebSocket(socket) {
    if (!socket || socket.readyState === socket.CLOSED) return;
    const closed = waitForClose(socket);
    if (socket.readyState === socket.CONNECTING) socket.terminate();
    else socket.close();
    await closed;
}

module.exports = {
    closeWebSocket,
    nextMessage,
    request,
    silentLogger,
    waitForClose,
    waitForListening,
    waitForOpen,
    withTimeout,
};
