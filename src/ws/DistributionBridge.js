const { randomUUID } = require('crypto');
const { performance } = require('perf_hooks');
const { throwCleanupErrors } = require('../serverLifecycle');

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
            publishTimeoutMs = lifecycleTimeoutMs,
            maxConcurrentPublishes = 64,
            maxConcurrentEvents = 64,
            required = false,
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
        const integers = {
            maxEventBytes,
            maxSeenEvents,
            seenTtlMs,
            lifecycleTimeoutMs,
            publishTimeoutMs,
            maxConcurrentPublishes,
            maxConcurrentEvents,
        };
        for (const [name, value] of Object.entries(integers)) {
            if (!Number.isInteger(value) || value < 1) throw new TypeError(`\`distribution.${name}\` must be a positive integer.`);
        }
        if (typeof required !== 'boolean') throw new TypeError('`distribution.required` must be a boolean.');
        if (typeof onEvent !== 'function') throw new TypeError('`distribution.onEvent` must be a function.');
        if (typeof clock !== 'function') throw new TypeError('`clock` must be a function.');
        Object.assign(this, {
            adapter,
            channel,
            nodeId,
            maxEventBytes,
            maxSeenEvents,
            seenTtlMs,
            lifecycleTimeoutMs,
            publishTimeoutMs,
            maxConcurrentPublishes,
            maxConcurrentEvents,
            required,
            onEvent,
            logger,
            clock,
        });
        this.seen = new Map();
        this.publishes = new Set();
        this.events = new Set();
        this.closed = false;
        this.healthy = false;
        this.subscribed = false;
        this.ready = this.start();
    }

    async start() {
        try {
            await this.withTimeout(
                signal => this.adapter.start?.(signal),
                this.lifecycleTimeoutMs,
                'start',
                () => this.adapter.close?.()
            );
            if (this.closed) return false;
            const unsubscribe = await this.withTimeout(
                signal => this.adapter.subscribe(this.channel, event => this.receive(event), signal),
                this.lifecycleTimeoutMs,
                'subscribe',
                lateUnsubscribe => typeof lateUnsubscribe === 'function'
                    ? lateUnsubscribe()
                    : this.adapter.unsubscribe?.(this.channel)
            );
            if (typeof unsubscribe === 'function') this.unsubscribe = unsubscribe;
            this.subscribed = true;
            this.healthy = true;
            return true;
        } catch (error) {
            this.logger?.error?.('Distribution adapter failed to start:', error);
            return false;
        }
    }

    withTimeout(operation, timeoutMs, name, compensateLate) {
        let timer;
        let timedOut = false;
        const controller = new AbortController();
        const task = Promise.resolve().then(() => operation(controller.signal));
        void task.then(value => {
            if (!timedOut || !compensateLate) return;
            Promise.resolve()
                .then(() => compensateLate(value))
                .catch(error => this.logger?.error?.(`Late distribution ${name} cleanup failed:`, error));
        }, error => {
            if (timedOut) this.logger?.error?.(`Distribution adapter ${name} failed after timeout:`, error);
        });
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
                timedOut = true;
                controller.abort();
                reject(new Error(`Distribution adapter ${name} timed out.`));
            }, timeoutMs);
            timer.unref();
        });
        return Promise.race([task, timeout]).finally(() => clearTimeout(timer));
    }

    isReady() {
        return this.healthy && !this.closed;
    }

    publish(type, payload) {
        if (this.closed || typeof type !== 'string' || !type || this.publishes.size >= this.maxConcurrentPublishes) {
            return Promise.resolve(false);
        }
        const event = { id: randomUUID(), source: this.nodeId, type, payload };
        const serialized = this.serialize(event);
        if (!serialized) return Promise.resolve(false);
        const task = this.performPublish(serialized);
        this.track(this.publishes, task);
        return task;
    }

    async performPublish(serialized) {
        if (!await this.ready || this.closed) return false;
        try {
            await this.withTimeout(
                signal => this.adapter.publish(this.channel, serialized, signal),
                this.publishTimeoutMs,
                'publish'
            );
            this.healthy = true;
            return true;
        } catch (error) {
            this.healthy = false;
            this.logger?.error?.('Distribution publish failed:', error);
            return false;
        }
    }

    track(collection, task) {
        collection.add(task);
        const cleanup = () => collection.delete(task);
        void task.then(cleanup, cleanup);
    }

    receive(input) {
        if (this.closed || this.events.size >= this.maxConcurrentEvents) return false;
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
        const task = Promise.resolve()
            .then(() => this.onEvent(event))
            .catch(error => this.logger?.error?.('Distribution event handler failed:', error));
        this.track(this.events, task);
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

    evictExpired(now) {
        while (this.seen.size) {
            const [eventId, expiry] = this.seen.entries().next().value;
            if (expiry > now) return;
            this.seen.delete(eventId);
        }
    }

    remember(id) {
        const now = this.clock();
        this.evictExpired(now);
        while (this.seen.size >= this.maxSeenEvents) this.seen.delete(this.seen.keys().next().value);
        this.seen.set(id, now + this.seenTtlMs);
    }

    async stopSubscription() {
        if (!this.subscribed) return;
        this.subscribed = false;
        await this.withTimeout(
            signal => this.unsubscribe ? this.unsubscribe() : this.adapter.unsubscribe?.(this.channel, signal),
            this.lifecycleTimeoutMs,
            'unsubscribe'
        );
    }

    async drainActivity() {
        await this.withTimeout(
            () => Promise.allSettled([...this.publishes, ...this.events]),
            this.lifecycleTimeoutMs,
            'drain'
        );
    }

    async close() {
        if (this.closed) return;
        this.closed = true;
        this.healthy = false;
        await this.ready;
        const errors = [];
        for (const operation of [
            () => this.stopSubscription(),
            () => this.drainActivity(),
            () => this.withTimeout(signal => this.adapter.close?.(signal), this.lifecycleTimeoutMs, 'close'),
        ]) {
            try {
                await operation();
            } catch (error) {
                errors.push(error);
            }
        }
        this.seen.clear();
        this.publishes.clear();
        this.events.clear();
        throwCleanupErrors(errors, 'One or more distribution adapter cleanup operations failed.');
    }
}

module.exports = DistributionBridge;
