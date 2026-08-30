'use strict';

// Real HTTP/WebSocket control for the evaluator, not a substitute Redweb test.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const fault = process.env.EVALUATION_FAULT || '';
const peers = new Map();
let count = 0;
const messages = [];
const streams = new Set();
const snapshot = () => ({ count, messages, members: [...peers.values()].filter(Boolean) });
const server = http.createServer((req, res) => {
    if (req.url === '/events') {
        res.setHeader('content-type', 'text/event-stream');
        res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
        streams.add(res); res.on('close', () => streams.delete(res)); return;
    }
    if (req.url === '/late.js') {
        res.setHeader('content-type', 'text/javascript');
        return res.end('window.lateIncrement = () => socket.send(JSON.stringify({ type: "increment" }));');
    }
    if (req.url === '/snapshot') {
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify(snapshot()));
    }
    res.setHeader('content-type', 'text/html');
    res.end(fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8').replace('__FAULT__', JSON.stringify(fault)));
});
const sockets = new WebSocketServer({ server });
const send = peer => { if (peer.readyState === WebSocket.OPEN) peer.send(JSON.stringify(snapshot())); };
const broadcast = () => {
    for (const peer of peers.keys()) send(peer);
    for (const stream of streams) stream.write(`data: ${JSON.stringify(snapshot())}\n\n`);
};
sockets.on('connection', peer => {
    peers.set(peer, '');
    send(peer);
    peer.on('message', raw => {
        const event = JSON.parse(String(raw));
        if (event.type === 'increment') {
            count += 1;
            if (fault === 'local-counter') return send(peer);
        }
        if (event.type === 'join') peers.set(peer, event.name);
        if (event.type === 'send') messages.push({ name: peers.get(peer), text: event.text });
        broadcast();
    });
    peer.on('close', () => {
        if (fault === 'stale-presence') return;
        peers.delete(peer);
        broadcast();
    });
});
server.listen(0, fault === 'wildcard-bind' ? '0.0.0.0' : '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}` })));
