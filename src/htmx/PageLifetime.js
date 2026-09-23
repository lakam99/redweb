'use strict';
const { AccessDenied } = require('../access/AccessPolicy');

/** Cancellation shared by HTTP work, reconnectable sessions, and individual connections. */
class PageLifetime {
    constructor(parent) {
        this.controller = new AbortController();
        this.parent = parent;
        this.abort = () => {
            this.revoked = true;
            this.controller.abort();
            parent.removeEventListener('abort', this.abort);
        };
        parent.addEventListener('abort', this.abort, { once: true });
        if (parent.aborted) this.abort();
    }

    get signal() { return this.controller.signal; }
    check() { if (this.revoked) throw new AccessDenied('ACCESS_CANCELLED'); }

    async wait(operation) {
        this.check();
        let abort;
        try {
            const cancelled = new Promise((_, reject) => {
                abort = () => reject(new AccessDenied('ACCESS_CANCELLED'));
                this.signal.addEventListener('abort', abort, { once: true });
            });
            const work = Promise.resolve().then(() => { this.check(); return operation(); });
            const result = await Promise.race([work, cancelled]);
            this.check();
            return result;
        } finally { this.signal.removeEventListener('abort', abort); }
    }
}

module.exports = PageLifetime;
