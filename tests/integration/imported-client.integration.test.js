'use strict';

const WebSocket = require('ws');
const BrowserClientPeer = require('../fixtures/BrowserClientPeer');
const browserClientCases = require('../fixtures/browser-client-cases');

test('imported client requests, cancellation, queues and reconnection use actual network traffic', async () => {
    const peer = new BrowserClientPeer();
    await peer.run(async () => {
        const result = await browserClientCases(require('redweb-client'), peer.url,
            { webSocketFactory: url => new WebSocket(url) });
        expect(result.assertions).toBeGreaterThan(30);
    });
}, 20000);
