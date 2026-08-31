'use strict';

const assert = require('node:assert/strict');
const { WebSocket, waitFor, closeClient } = require('../realtime-harness');
const { settleTasks } = require('../../src/serverLifecycle');
const { verificationError } = require('./verificationError');

/** Own every socket immediately, with exact pending ticks per connection. */
class SoakClients {
    constructor(url, count, onFailure) {
        this.url = url;
        this.slots = new Array(count);
        this.generations = new Array(count).fill(0);
        this.records = new Set();
        this.sent = 0;
        this.received = 0;
        this.failure = null;
        this.onFailure = onFailure;
    }

    fail(error) {
        if (!this.failure) { this.failure = verificationError(error); this.onFailure(this.failure); }
    }

    check() { if (this.failure) throw this.failure; }

    async open(slot) {
        const socket = new WebSocket(this.url, { handshakeTimeout: 5000 });
        const record = { socket, pending: new Set(), closing: false };
        this.records.add(record);
        record.message = raw => {
            if (this.failure) return;
            try {
                const reply = JSON.parse(String(raw));
                assert(reply && typeof reply === 'object' && !Array.isArray(reply) && Object.keys(reply).length === 1 &&
                    Number.isSafeInteger(reply.tick) && record.pending.has(reply.tick), 'Unexpected, duplicate or malformed soak reply.');
                record.pending.delete(reply.tick);
                this.received++;
            } catch (error) { this.fail(error); }
        };
        record.error = error => { if (!record.closing) this.fail(error); };
        record.closed = (code, reason) => {
            if (record.closing) return;
            const detail = Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason ?? '');
            const suffix = detail ? `, reason ${JSON.stringify(detail)}` : '';
            this.fail(new Error(`Soak client disconnected unexpectedly (code ${code ?? 'unknown'}${suffix}).`));
        };
        socket.on('message', record.message); socket.on('error', record.error); socket.on('close', record.closed);
        await waitFor(socket, 'open');
        this.slots[slot] = record;
        this.check();
    }

    async openInitial() {
        const failures = (await settleTasks(this.generations.map((_generation, slot) => () => this.open(slot)))).map(verificationError);
        if (failures.length) throw new AggregateError(failures, failures[0].message, { cause: failures[0] });
    }

    sendTick(tick) {
        this.check();
        for (const [slot, record] of this.slots.entries()) {
            if (record.socket.readyState === WebSocket.OPEN && !record.closing) {
                record.pending.add(tick);
                record.socket.send(JSON.stringify({ type: 'cycle', slot, generation: this.generations[slot], tick }));
                this.sent++;
            }
        }
    }

    async close(record) {
        record.closing = true;
        await closeClient(record.socket);
        record.socket.off('message', record.message); record.socket.off('error', record.error); record.socket.off('close', record.closed);
        this.records.delete(record);
        record.pending.clear();
    }

    async rotate(slot, stopped) {
        await this.close(this.slots[slot]);
        this.generations[slot]++;
        if (!stopped()) await this.open(slot);
    }

    async closeAll() {
        const failures = (await settleTasks([...this.records].map(record => () => this.close(record)))).map(verificationError);
        if (failures.length) throw new AggregateError(failures, failures[0].message, { cause: failures[0] });
        this.slots.length = 0;
    }
}

module.exports = { SoakClients };
