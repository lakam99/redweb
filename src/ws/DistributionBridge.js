const { randomUUID } = require('crypto');
const { performance } = require('perf_hooks');
const { settleTasks, throwCleanupErrors } = require('../serverLifecycle');

class DistributionBridge {
    constructor(options, onEvent, logger = console, clock = () => performance.now()) {
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
            throw new TypeError('`distribution` must be an object.');
        }
        const {
            adapter,
            channel,
            nodeId = randomUUID(),
            maxEventBytes = 64 * 1024,
            maxSeenEvents = 10_000,
            seenTtlMs = 60_000,
            lifecycleTimeoutMs = 5000,
        } = options;
        if (!adapter || typeof adapter !== 'object') throw new TypeError('`distribution.adapter` is required.');
        ['publish', 'subscribe'].forEach(method => {
            if (typeof adapter[method] !== 'function') throw new TypeError(`\`distribution.adapter.${method}\` must be a function.`);
        });
        ['start', 'unsubscribe', 'close'].forEach(method => {
            if (adapter[method] !== undefined && typeof adapter[method] !== 'function') {
                throw new TypeError(`\`distribution.adapter.${method}\` must be a function.`);
            }
        });
        if (typeof channel !== 'string' || !channel) throw new TypeError('`distribution.channel` must be a non-empty string.');
        if (typeof nodeId !== 'string' || !nodeId || nodeId.length > 256) {
            throw new TypeError('`distribution.nodeId` must be a non-empty string of at most 256 characters.');
        }
        for (const [name, value] of Object.entries({ maxEventBytes, maxSeenEvents, seenTtlMs, lifecycleTimeoutMs })) {
            if (!Number.isInteger(value) || value < 1) throw new TypeError(`\`distribution.${name}\` must be a positive integer.`);
        }
        if (typeof onEvent !== 'function') throw new TypeError('`distribution.onEvent` must be a function.');
        if (typeof clock !== 'function') throw new TypeError('`clock` must be a function.');
        this.adapter = adapter;
        this.channel = channel;
        this.nodeId = nodeId;
        this.maxEventBytes = maxEventBytes;
        this.maxSeenEvents = maxSeenEvents;
        this.seenTtlMs = seenTtlMs;
        this.lifecycleTimeoutMs = lifecycleTimeoutMs;
        this.onEvent = onEvent;
        this.logger = logger;
        this.clock = clock;
        this.seen = new Map();
        this.closed = false;
        this.ready = this.start();
    }

    async start() {
        try {
            await this.withLifecycleTimeout(() => this.adapter.start?.(), 'start');
            if (this.closed) return false;
            const unsubscribe = await this.withLifecycleTimeout(
                () => this.adapter.subscribe(this.channel, event => this.receive(event)),
                'subscribe'
            );
            if (typeof unsubscribe === 'function') this.unsubscribe = unsubscribe;
            return true;
        } catch (error) {
            this.logger?.error?.('Distribution adapter failed to start:', error);
            return false;
        }
    }

    withLifecycleTimeout(operation, name) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(
                () => reject(new Error(`Distribution adapter ${name} timed out.`)),
                this.lifecycleTimeoutMs
            );
            timer.unref();
        });
        return Promise.race([Promise.resolve().then(operation), timeout]).finally(() => clearTimeout(timer));
    }

    async publish(type, payload) {
        if (this.closed || typeof type !== 'string' || !type) return false;
        const event = {
            id: randomUUID(),
            source: this.nodeId,
            type,
            payload,
        };
        const serialized = this.serialize(event);
        if (!serialized) return false;
        if (!await this.ready || this.closed) return false;
        try {
            await this.adapter.publish(this.channel, serialized);
            return true;
        } catch (error) {
            this.logger?.error?.('Distribution publish failed:', error);
            return false;
        }
    }

    receive(input) {
        if (this.closed) return false;
        let event;
        try {
            const serialized = typeof input === 'string' ? input : JSON.stringify(input);
            if (Buffer.byteLength(serialized) > this.maxEventBytes) return false;
            event = typeof input === 'string' ? JSON.parse(input) : input;
        } catch {
            return false;
        }
        if (!this.isValid(event) || event.source === this.nodeId || this.hasSeen(event.id)) return false;
        this.remember(event.id);
        Promise.resolve()
            .then(() => this.onEvent(event))
            .catch(error => this.logger?.error?.('Distribution event handler failed:', error));
        return true;
    }

    isValid(event) {
        return Boolean(
            event &&
            typeof event === 'object' &&
            typeof event.id === 'string' && event.id && event.id.length <= 256 &&
            typeof event.source === 'string' && event.source && event.source.length <= 256 &&
            typeof event.type === 'string' && event.type && event.type.length <= 256
        );
    }

    serialize(event) {
        try {
            const serialized = JSON.stringify(event);
            return Buffer.byteLength(serialized) <= this.maxEventBytes ? serialized : null;
        } catch {
            return null;
        }
    }

    hasSeen(id) {
        const expiry = this.seen.get(id);
        if (expiry === undefined) return false;
        if (expiry <= this.clock()) {
            this.seen.delete(id);
            return false;
        }
        return true;
    }

    remember(id) {
        const now = this.clock();
        this.seen.forEach((expiry, eventId) => {
            if (expiry <= now) this.seen.delete(eventId);
        });
        while (this.seen.size >= this.maxSeenEvents) this.seen.delete(this.seen.keys().next().value);
        this.seen.set(id, now + this.seenTtlMs);
    }

    async close() {
        if (this.closed) return;
        this.closed = true;
        await this.ready;
        const errors = await settleTasks([
            () => this.withLifecycleTimeout(
                () => this.unsubscribe ? this.unsubscribe() : this.adapter.unsubscribe?.(this.channel),
                'unsubscribe'
            ),
            () => this.withLifecycleTimeout(() => this.adapter.close?.(), 'close'),
        ]);
        this.seen.clear();
        throwCleanupErrors(errors, 'One or more distribution adapter cleanup operations failed.');
    }
}

module.exports = DistributionBridge;
