'use strict';

const assert = require('node:assert/strict');

/** Fixed-workload accounting: one outstanding request per client, consumed once. */
class LoadMeasurement {
    constructor(environment = process.env) {
        this.clientCount = Number(environment.REDWEB_LOAD_CLIENTS ?? 32);
        this.messagesPerClient = Number(environment.REDWEB_LOAD_MESSAGES ?? 100);
        this.maximumP99Ms = Number(environment.REDWEB_LOAD_MAX_P99_MS ?? 250);
        this.minimumMessagesPerSecond = Number(environment.REDWEB_LOAD_MIN_MPS ?? 500);
        assert(Number.isSafeInteger(this.clientCount) && this.clientCount >= 2 && Number.isSafeInteger(this.clientCount + 2),
            'REDWEB_LOAD_CLIENTS must be a safe integer of at least 2 with capacity for two extra connections.');
        assert(Number.isSafeInteger(this.messagesPerClient) && this.messagesPerClient >= 1 && Number.isSafeInteger(this.messagesPerClient + 1),
            'REDWEB_LOAD_MESSAGES must be a positive safe integer with capacity for one extra message.');
        this.expectedMessages = this.clientCount * this.messagesPerClient;
        assert(Number.isSafeInteger(this.expectedMessages), 'Load message total must be a safe integer.');
        assert(Number.isFinite(this.maximumP99Ms) && this.maximumP99Ms > 0, 'REDWEB_LOAD_MAX_P99_MS must be positive and finite.');
        assert(Number.isFinite(this.minimumMessagesPerSecond) && this.minimumMessagesPerSecond > 0, 'REDWEB_LOAD_MIN_MPS must be positive and finite.');
        this.sequences = new Array(this.clientCount).fill(0);
        this.pending = new Map();
        this.latencies = [];
        this.received = 0;
    }

    next(index, now) {
        assert(Number.isInteger(index) && index >= 0 && index < this.clientCount, 'Invalid load client index.');
        assert(Number.isFinite(now) && now >= 0, 'Invalid load send timestamp.');
        assert(!this.pending.has(index), 'A load client already has an outstanding request.');
        if (this.sequences[index] === this.messagesPerClient) return null;
        const id = `${index}:${this.sequences[index]++}`;
        this.pending.set(index, { id, startedAt: now });
        return id;
    }

    receive(index, reply, now) {
        assert(reply && typeof reply === 'object' && !Array.isArray(reply) &&
            Object.keys(reply).length === 1 && typeof reply.id === 'string', 'Malformed load reply.');
        const expected = this.pending.get(index);
        assert(expected && reply.id === expected.id, 'Unexpected, duplicate or foreign-client load reply.');
        const latency = now - expected.startedAt;
        assert(Number.isFinite(now) && Number.isFinite(latency) && latency >= 0, 'Invalid load reply latency.');
        this.pending.delete(index);
        this.latencies.push(latency);
        this.received++;
        return this.received === this.expectedMessages;
    }

    summarize(elapsedMs, slowConsumerContained) {
        assert(this.received === this.expectedMessages && this.pending.size === 0 &&
            this.sequences.every(sequence => sequence === this.messagesPerClient) &&
            this.latencies.length === this.expectedMessages, 'Incomplete load measurement.');
        assert(Number.isFinite(elapsedMs) && elapsedMs > 0, 'Load elapsed time must be positive and finite.');
        assert(typeof slowConsumerContained === 'boolean', 'Missing slow-consumer outcome.');
        const sorted = [...this.latencies].sort((left, right) => left - right);
        const result = { clients: this.clientCount, messages: this.received,
            messagesPerSecond: this.received / elapsedMs * 1000,
            p99Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1)],
            slowConsumerContained };
        assert(Number.isFinite(result.messagesPerSecond) && result.messagesPerSecond > 0 &&
            Number.isFinite(result.p99Ms) && result.p99Ms >= 0, 'Invalid load result.');
        return result;
    }

    passed(result) {
        return result.p99Ms <= this.maximumP99Ms && result.messagesPerSecond >= this.minimumMessagesPerSecond && result.slowConsumerContained;
    }
}

module.exports = { LoadMeasurement };
