'use strict';

const assert = require('node:assert/strict');

class BenchmarkWorkload {
    constructor(messages = 20000, concurrency = 128) {
        this.messages = Number(messages);
        this.concurrency = Number(concurrency);
        assert(Number.isSafeInteger(this.messages) && this.messages >= 1000, 'Benchmark message count must be a safe integer of at least 1000.');
        assert(Number.isSafeInteger(this.concurrency) && this.concurrency >= 1, 'Benchmark concurrency must be a positive safe integer.');
        this.warmupMessages = Math.min(2000, Math.max(200, Math.floor(this.messages / 10)));
        assert(Number.isSafeInteger(this.messages + this.warmupMessages), 'Benchmark message count must leave room for warm-up IDs.');
    }
}

module.exports = { BenchmarkWorkload };
