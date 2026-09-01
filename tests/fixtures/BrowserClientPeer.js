'use strict';

const http = require('node:http');
const { WebSocketServer } = require('ws');
const { waitForListening, withTimeout } = require('../helpers/network');
const { verificationError } = require('../../scripts/lib/verificationError');

// A real wire-protocol peer for client tests, including intentionally malformed
// server frames. It is not a replacement WebSocket or a simulated client API.
class BrowserClientPeer {
    constructor() {
        this.server = http.createServer((_request, response) => { response.writeHead(404).end(); });
        this.sockets = new WebSocketServer({ noServer: true });
        this.server.on('upgrade', (request, socket, head) => {
            if (request.url.startsWith('/refuse')) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
            this.sockets.handleUpgrade(request, socket, head, client => this.sockets.emit('connection', client, request));
        });
        this.sockets.on('connection', (socket, request) => {
            const version = new URL(request.url, 'http://localhost').searchParams.get('redwebVersion');
            const seen = [];
            socket.on('error', () => {});
            socket.on('message', (data, binary) => {
                if (binary) { socket.send(data, { binary: true }); return; }
                const message = JSON.parse(data.toString());
                seen.push(message.type);
                const reply = (type, payload) => socket.send(JSON.stringify({ ...(version ? { v: version } : {}), type, payload,
                    ...(message.requestId === undefined ? {} : { requestId: message.requestId }) }));
                switch (message.type) {
                    case 'ignore': return;
                    case 'barrier': reply('barrier', { seen }); return;
                    case 'malformed': socket.send('{'); return;
                    case 'legacy-error': socket.send(JSON.stringify({ error: 'Legacy rejection' })); return;
                    case 'fail': socket.send(JSON.stringify({ v: version, type: 'error', requestId: message.requestId,
                        error: { code: 'DENIED', message: 'Peer rejected request' } })); return;
                    case 'close': socket.close(message.payload.code, 'Peer closed'); return;
                    case 'terminate': socket.terminate(); return;
                    default: reply(message.type, Object.hasOwn(message, 'payload') ? message.payload : message.value ?? null);
                }
            });
        });
    }

    async listen() {
        this.server.listen(0, '127.0.0.1');
        await waitForListening(this.server);
        this.url = `ws://127.0.0.1:${this.server.address().port}/client`;
        return this;
    }

    async close() {
        for (const socket of this.sockets.clients) socket.terminate();
        await withTimeout(Promise.all([
            new Promise(resolve => this.sockets.close(resolve)),
            new Promise(resolve => this.server.close(resolve)),
        ]), 'client peer shutdown', 5000);
    }

    async run(operation) {
        let result, failure;
        try { await this.listen(); result = await operation(this); }
        catch (error) { failure = verificationError(error); }
        try { await this.close(); }
        catch (error) {
            const cleanup = verificationError(error);
            failure = failure ? new AggregateError([failure, cleanup], failure.message, { cause: failure }) : cleanup;
        }
        if (failure) throw failure;
        return result;
    }
}

module.exports = BrowserClientPeer;
