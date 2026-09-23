const { performance } = require('perf_hooks');

class TokenBucket {
    constructor({ capacity, refillPerSecond }, clock = () => performance.now()) {
        if (!Number.isFinite(capacity) || capacity <= 0) {
            throw new TypeError('`capacity` must be a positive number.');
        }
        if (!Number.isFinite(refillPerSecond) || refillPerSecond < 0) {
            throw new TypeError('`refillPerSecond` must be a non-negative number.');
        }
        if (typeof clock !== 'function') throw new TypeError('`clock` must be a function.');
        this.capacity = capacity;
        this.refillPerMs = refillPerSecond / 1000;
        this.tokens = capacity;
        this.clock = clock;
        this.updatedAt = clock();
    }

    consume(cost = 1) {
        if (!Number.isFinite(cost) || cost <= 0) throw new TypeError('`cost` must be a positive number.');
        const now = this.clock();
        const elapsed = Math.max(0, now - this.updatedAt);
        this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
        this.updatedAt = now;
        if (this.tokens < cost) return false;
        this.tokens -= cost;
        return true;
    }
}

module.exports = TokenBucket;
