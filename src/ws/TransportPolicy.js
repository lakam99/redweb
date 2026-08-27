const TokenBucket = require('./TokenBucket');
const TaskQueue = require('./TaskQueue');

const RATE_ACTIONS = new Set(['drop', 'disconnect']);
const SLOW_ACTIONS = new Set(['drop', 'disconnect']);

class TransportPolicy {
    constructor(limits = {}, orderedMessages = false) {
        if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
            throw new TypeError('`limits` must be an object.');
        }
        const {
            maxConnections = Infinity,
            maxBufferedBytes = Infinity,
            maxPendingMessages = 64,
            messageRate = null,
            slowConsumerAction = 'disconnect',
        } = limits;
        if (!(maxConnections === Infinity || Number.isInteger(maxConnections) && maxConnections > 0)) {
            throw new TypeError('`limits.maxConnections` must be a positive integer.');
        }
        if (!(maxBufferedBytes === Infinity || Number.isInteger(maxBufferedBytes) && maxBufferedBytes >= 0)) {
            throw new TypeError('`limits.maxBufferedBytes` must be a non-negative integer.');
        }
        if (!Number.isInteger(maxPendingMessages) || maxPendingMessages < 1) {
            throw new TypeError('`limits.maxPendingMessages` must be a positive integer.');
        }
        if (!SLOW_ACTIONS.has(slowConsumerAction)) {
            throw new TypeError('`limits.slowConsumerAction` must be "drop" or "disconnect".');
        }
        if (messageRate !== null) {
            if (!messageRate || typeof messageRate !== 'object' || Array.isArray(messageRate)) {
                throw new TypeError('`limits.messageRate` must be an object.');
            }
            if (!RATE_ACTIONS.has(messageRate.action ?? 'disconnect')) {
                throw new TypeError('`limits.messageRate.action` must be "drop" or "disconnect".');
            }
            // Validate once without retaining the probe.
            new TokenBucket(messageRate);
        }
        this.maxConnections = maxConnections;
        this.maxBufferedBytes = maxBufferedBytes;
        this.maxPendingMessages = maxPendingMessages;
        this.messageRate = messageRate && { ...messageRate, action: messageRate.action ?? 'disconnect' };
        this.slowConsumerAction = slowConsumerAction;
        this.orderedMessages = Boolean(orderedMessages);
    }

    createRuntime(onError, errorContext) {
        return {
            limiter: this.messageRate ? new TokenBucket(this.messageRate) : null,
            queue: this.orderedMessages ? new TaskQueue(this.maxPendingMessages, onError, errorContext) : null,
        };
    }

    acceptsMessage(runtime) {
        return runtime?.limiter ? runtime.limiter.consume() : true;
    }

    acceptsSend(socket, payloadBytes) {
        if (this.maxBufferedBytes === Infinity) return true;
        if ((socket.bufferedAmount || 0) + payloadBytes <= this.maxBufferedBytes) return true;
        if (this.slowConsumerAction === 'disconnect') socket.close?.(1013, 'Slow consumer');
        return false;
    }
}

module.exports = TransportPolicy;
