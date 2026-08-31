'use strict';

const assert = require('node:assert/strict');

/** Exact accounting for the benchmark's bounded window of outstanding requests. */
class BenchmarkBatch {
    constructor(count, width, recordLatency, offset = 0) {
        assert(Number.isSafeInteger(count) && count > 0, 'Invalid benchmark batch size.');
        assert(Number.isSafeInteger(width) && width > 0, 'Invalid benchmark window size.');
        assert(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(offset + count), 'Invalid benchmark ID range.');
        assert(typeof recordLatency === 'boolean', 'Invalid benchmark latency mode.');
        this.count = count;
        this.width = width;
        this.offset = offset;
        this.recordLatency = recordLatency;
        this.sent = 0;
        this.received = 0;
        this.pending = new Map();
        this.latencies = [];
    }

    next(now) {
        assert(Number.isFinite(now) && now >= 0, 'Invalid benchmark send timestamp.');
        if (this.sent === this.count || this.pending.size >= this.width) return null;
        const id = this.offset + this.sent++;
        this.pending.set(id, now);
        return id;
    }

    receive(reply, now) {
        assert(reply && typeof reply === 'object' && !Array.isArray(reply) && Object.keys(reply).length === 1 &&
            Number.isSafeInteger(reply.id) && this.pending.has(reply.id), 'Unexpected, duplicate or malformed benchmark reply.');
        const elapsed = now - this.pending.get(reply.id);
        assert(Number.isFinite(now) && Number.isFinite(elapsed) && elapsed >= 0, 'Invalid benchmark reply latency.');
        this.pending.delete(reply.id);
        if (this.recordLatency) this.latencies.push(elapsed);
        this.received++;
        return this.received === this.count;
    }

    summarize(elapsedMs) {
        assert(this.sent === this.count && this.received === this.count && this.pending.size === 0 &&
            this.latencies.length === (this.recordLatency ? this.count : 0), 'Incomplete benchmark batch.');
        assert(Number.isFinite(elapsedMs) && elapsedMs > 0, 'Invalid benchmark elapsed time.');
        return { sent: this.sent, received: this.received, elapsedMs, latencies: [...this.latencies] };
    }
}

module.exports = { BenchmarkBatch };
