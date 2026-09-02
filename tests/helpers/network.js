const http = require('http');
const https = require('https');
const crypto = require('crypto');
const net = require('net');

const silentLogger = Object.freeze({ log() {}, warn() {}, error() {} });

function withTimeout(promise, label, timeoutMs = 10000) {
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

function websocketUpgradeResponse(url, options = {}) {
    const target = new URL(url);
    const transport = target.protocol === 'wss:' ? https : http;
    return withTimeout(new Promise((resolve) => {
        const upgrade = transport.request({
            host: target.hostname,
            port: target.port,
            path: `${target.pathname}${target.search}`,
            rejectUnauthorized: options.rejectUnauthorized,
            headers: {
                Connection: 'Upgrade',
                Upgrade: 'websocket',
                'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
                'Sec-WebSocket-Version': '13',
                ...options.headers,
            },
        });
        upgrade.once('response', response => {
            response.on('error', () => {});
            response.resume();
            resolve({ status: response.statusCode, headers: response.headers });
        });
        upgrade.once('upgrade', (_response, socket) => {
            socket.destroy();
            resolve({ status: 101, headers: _response.headers });
        });
        upgrade.on('error', () => resolve({ status: 'error', headers: {} }));
        upgrade.end();
    }), 'WebSocket upgrade response');
}

async function websocketUpgradeStatus(url, options) {
    return (await websocketUpgradeResponse(url, options)).status;
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
        const cleanup = () => {
            socket.off('message', onMessage);
            socket.off('error', onError);
        };
        const onMessage = (data, isBinary) => { cleanup(); resolve({ data, isBinary }); };
        const onError = error => { cleanup(); reject(error); };
        socket.once('message', onMessage);
        socket.once('error', onError);
    }), 'WebSocket message');
}

async function waitForCondition(predicate, label, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
        await new Promise(resolve => setTimeout(resolve, 10));
    }
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

function openRawWebSocket(port, route, { allowHalfOpen = false, headers = {} } = {}) {
    let socket;
    return withTimeout(new Promise((resolve, reject) => {
        socket = net.connect({ port, host: '127.0.0.1', allowHalfOpen });
        let response = '';
        socket.once('connect', () => {
            const key = crypto.randomBytes(16).toString('base64');
            socket.write([
                `GET ${route} HTTP/1.1`,
                `Host: 127.0.0.1:${port}`,
                'Upgrade: websocket',
                'Connection: Upgrade',
                `Sec-WebSocket-Key: ${key}`,
                'Sec-WebSocket-Version: 13',
                ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
                '',
                '',
            ].join('\r\n'));
        });
        const readHandshake = chunk => {
            response += chunk.toString('latin1');
            if (!response.includes('\r\n\r\n')) return;
            socket.off('data', readHandshake);
            if (!response.startsWith('HTTP/1.1 101')) return reject(new Error(`Unexpected upgrade response: ${response}`));
            resolve(socket);
        };
        socket.on('data', readHandshake);
        socket.once('error', reject);
    }), 'raw WebSocket upgrade').catch(error => { socket?.destroy(); throw error; });
}

module.exports = {
    closeWebSocket,
    nextMessage,
    openRawWebSocket,
    request,
    silentLogger,
    waitForClose,
    waitForCondition,
    waitForListening,
    waitForOpen,
    websocketUpgradeResponse,
    websocketUpgradeStatus,
    withTimeout,
};
