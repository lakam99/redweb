'use strict';

const assert = require('node:assert/strict');
const { WebSocket, closeClient } = require('../realtime-harness');
const { RedwebClient } = require('redweb-client');
const { withTimeout } = require('../../tests/helpers/network');
const { settleTasks } = require('../../src/serverLifecycle');
const { verificationError } = require('./verificationError');

/** The actual client and all sockets it creates share one verification lifetime. */
class LiveHtmlLoadClient {
    constructor(port, config, updates) {
        this.sockets = new Set();
        this.closing = false;
        this.failure = null;
        const fail = error => { if (!this.closing && !this.failure) this.failure = verificationError(error); };
        this.client = new RedwebClient(`ws://127.0.0.1:${port}${config.socketPath}?pageId=${encodeURIComponent(config.pageId)}`, {
            version: config.version,
            webSocketFactory: url => {
                const socket = new WebSocket(url, { handshakeTimeout: 5000, headers: { Origin: `http://127.0.0.1:${port}` } });
                this.sockets.add(socket);
                return socket;
            },
        });
        this.client.onError(fail);
        this.client.onClose(() => fail(new Error('Live HTML client disconnected during measurement.')));
        this.client.on('error', () => fail(new Error('Live HTML server returned a protocol error.')));
        this.client.on('redweb:patch', message => {
            try {
                const patches = message.payload?.patches;
                assert(Array.isArray(patches) && patches.length > 0 &&
                    patches.every(patch => patch && typeof patch.html === 'string'), 'Invalid Live HTML patch response.');
                updates.push(...patches);
            } catch (error) { fail(error); }
        });
    }

    check() { if (this.failure) throw this.failure; }

    async connect() {
        await withTimeout(this.client.connect(), 'Live HTML client connection', 10000);
        this.check();
    }

    async close() {
        this.closing = true;
        const failures = [];
        try { this.client.close(); } catch (error) { failures.push(verificationError(error)); }
        failures.push(...(await settleTasks([...this.sockets].map(socket => () => closeClient(socket)))).map(verificationError));
        if (failures.length) throw new AggregateError(failures, failures[0].message, { cause: failures[0] });
        this.sockets.clear();
    }
}

module.exports = { LiveHtmlLoadClient };
