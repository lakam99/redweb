'use strict';

const { AccessPolicy, AccessDenied } = require('../access/AccessPolicy');

/** Admission work is charged until the underlying policy settles, even after timeout. */
class RoomAccess {
    constructor(options, contextFor) {
        const { authorize, authorizationTimeoutMs, maxPendingAuthorizations = 128, maxPendingPerConnection = 4 } = options;
        for (const [name, value] of Object.entries({ maxPendingAuthorizations, maxPendingPerConnection })) {
            if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`rooms.${name} must be a positive safe integer.`);
        }
        if (typeof authorize !== 'function') throw new TypeError('rooms.authorize must be a function.');
        this.policy = new AccessPolicy(async (context, attempt) => {
            attempt.started = true;
            try { return await authorize(context, attempt.roomId); }
            finally { attempt.release(); }
        }, authorizationTimeoutMs);
        this.contextFor = contextFor;
        this.maximum = maxPendingAuthorizations;
        this.perConnection = maxPendingPerConnection;
        this.running = 0;
        this.counts = new WeakMap();
        this.pending = new Map();
        this.cancelling = new Set();
    }

    enter(roomId, socket, commit) {
        if (this.cancelling.has(socket)) return Promise.reject(new AccessDenied('ACCESS_CANCELLED'));
        const existing = this.pending.get(socket)?.get(roomId);
        if (existing) return existing.promise;
        const count = this.counts.get(socket) || 0;
        if (this.running >= this.maximum || count >= this.perConnection) return Promise.reject(new AccessDenied('ACCESS_CAPACITY'));
        const context = this.contextFor(socket);
        if (!context?.signal || context.signal.aborted) return Promise.reject(new AccessDenied('ACCESS_CANCELLED'));
        const controller = new AbortController();
        const attempt = { roomId, controller, started: false, release: () => {
            this.running--;
            this.counts.set(socket, this.counts.get(socket) - 1);
        } };
        this.running++;
        this.counts.set(socket, count + 1);
        const group = this.pending.get(socket) || new Map();
        group.set(roomId, attempt);
        this.pending.set(socket, group);
        const abort = () => controller.abort();
        context.signal.addEventListener('abort', abort, { once: true });
        attempt.promise = (async () => {
            try {
                await this.policy.check({ ...context, signal: controller.signal }, attempt);
                if (controller.signal.aborted) throw new AccessDenied('ACCESS_CANCELLED');
                return commit();
            } finally {
                context.signal.removeEventListener('abort', abort);
                if (!attempt.started) attempt.release();
                if (this.pending.get(socket)?.get(roomId) === attempt) {
                    group.delete(roomId);
                    if (!group.size) this.pending.delete(socket);
                }
            }
        })();
        return attempt.promise;
    }

    cancel(socket, roomId) {
        const group = this.pending.get(socket);
        if (!group) return;
        const attempts = [...group.values()].filter(attempt => roomId === undefined || attempt.roomId === roomId);
        if (!attempts.length) return;
        for (const attempt of attempts) group.delete(attempt.roomId);
        if (!group.size) this.pending.delete(socket);
        const nested = this.cancelling.has(socket);
        this.cancelling.add(socket);
        try { for (const attempt of attempts) attempt.controller.abort(); }
        finally { if (!nested) this.cancelling.delete(socket); }
    }

    clear() {
        for (const socket of [...this.pending.keys()]) this.cancel(socket);
    }
}

module.exports = RoomAccess;
