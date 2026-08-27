const { performance } = require('perf_hooks');

class SessionRegistry {
    constructor(options = {}, logger = console, clock = () => performance.now()) {
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
            throw new TypeError('`sessions` must be an object or true.');
        }
        const {
            ttlMs = 30_000,
            maxSessions = 10_000,
            maxSessionIdLength = 256,
            sweepIntervalMs = Math.min(ttlMs, 1000),
        } = options;
        for (const [name, value] of Object.entries({ ttlMs, maxSessions, maxSessionIdLength, sweepIntervalMs })) {
            if (!Number.isInteger(value) || value < 1) throw new TypeError(`\`sessions.${name}\` must be a positive integer.`);
        }
        if (typeof clock !== 'function') throw new TypeError('`clock` must be a function.');
        this.ttlMs = ttlMs;
        this.maxSessions = maxSessions;
        this.maxSessionIdLength = maxSessionIdLength;
        this.logger = logger;
        this.clock = clock;
        this.sessions = new Map();
        this.timer = setInterval(() => this.sweep(), sweepIntervalMs);
        this.timer.unref();
    }

    validateId(sessionId) {
        if (typeof sessionId !== 'string' || !sessionId || sessionId.length > this.maxSessionIdLength) {
            throw new TypeError(`Session IDs must be non-empty strings of at most ${this.maxSessionIdLength} characters.`);
        }
    }

    create(sessionId, data, socket) {
        this.validateId(sessionId);
        this.sweep();
        if (this.sessions.has(sessionId) || this.sessions.size >= this.maxSessions) return false;
        const record = { data, socket: null, expiresAt: this.clock() + this.ttlMs };
        this.sessions.set(sessionId, record);
        if (socket) this.assign(sessionId, record, socket);
        return true;
    }

    resume(sessionId, socket) {
        this.validateId(sessionId);
        const record = this.sessions.get(sessionId);
        if (!record) return null;
        if (!record.socket && record.expiresAt <= this.clock()) {
            this.sessions.delete(sessionId);
            return null;
        }
        this.assign(sessionId, record, socket);
        return record.data;
    }

    assign(sessionId, record, socket) {
        if (!socket) throw new TypeError('A socket is required to own a session.');
        const previousSessionId = socket.__redwebSessionId;
        if (previousSessionId && previousSessionId !== sessionId) this.release(socket);
        const previousSocket = record.socket;
        record.socket = socket;
        record.expiresAt = Infinity;
        socket.__redwebSessionId = sessionId;
        if (socket.context) socket.context.session = { id: sessionId, data: record.data };
        if (previousSocket && previousSocket !== socket) {
            previousSocket.__redwebSessionId = undefined;
            if (previousSocket.context) previousSocket.context.session = null;
            try {
                previousSocket.close?.(4000, 'Session resumed elsewhere');
            } catch (error) {
                this.logger?.error?.('Error closing replaced session socket:', error);
            }
        }
    }

    release(socket) {
        const sessionId = socket?.__redwebSessionId;
        if (!sessionId) return false;
        const record = this.sessions.get(sessionId);
        socket.__redwebSessionId = undefined;
        if (socket.context) socket.context.session = null;
        if (!record || record.socket !== socket) return false;
        record.socket = null;
        record.expiresAt = this.clock() + this.ttlMs;
        return true;
    }

    remove(sessionId) {
        this.validateId(sessionId);
        const record = this.sessions.get(sessionId);
        if (!record) return false;
        if (record.socket) {
            record.socket.__redwebSessionId = undefined;
            if (record.socket.context) record.socket.context.session = null;
        }
        return this.sessions.delete(sessionId);
    }

    get(sessionId) {
        this.validateId(sessionId);
        return this.sessions.get(sessionId)?.data;
    }

    sweep() {
        const now = this.clock();
        this.sessions.forEach((record, sessionId) => {
            if (!record.socket && record.expiresAt <= now) this.sessions.delete(sessionId);
        });
    }

    stop() {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
        this.sessions.forEach(record => {
            if (record.socket) {
                record.socket.__redwebSessionId = undefined;
                if (record.socket.context) record.socket.context.session = null;
            }
        });
        this.sessions.clear();
    }

    get size() {
        return this.sessions.size;
    }
}

module.exports = SessionRegistry;
