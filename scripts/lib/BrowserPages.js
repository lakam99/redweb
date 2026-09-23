'use strict';

const { verificationError } = require('./verificationError');

/** Own returned tabs and original opening promises, including late results. */
class BrowserPages {
    constructor(execution, openPage, bounded) {
        this.execution = execution;
        this.openPage = openPage;
        this.bounded = bounded;
        this.tabs = [];
        this.openings = [];
        this.closing = false;
        this.closed = null;
        this.failure = null;
    }

    open(port, url) {
        if (this.closing) return Promise.reject(new Error('Browser page owner is closing.'));
        const opening = { settled: false };
        opening.promise = Promise.resolve().then(() => this.openPage(port, url)).then(tab => {
            if (this.closing) this.release(tab);
            else this.tabs.push(tab);
            return tab;
        }).finally(() => { opening.settled = true; });
        this.openings.push(opening);
        return this.bounded(opening.promise, 'browser page startup');
    }

    record(value) {
        const error = verificationError(value);
        this.failure = this.failure ? new AggregateError([this.failure, error], this.failure.message, { cause: this.failure }) : error;
        this.execution.cleanupFailure = this.failure;
    }

    release(tab) {
        try { tab.socket.terminate(); }
        catch (error) { this.record(error); }
    }

    close() {
        if (!this.closed) {
            this.closing = true;
            this.closed = this.drain();
        }
        return this.closed;
    }

    async drain() {
        // A rejected opening is already an operation failure. An unsettled one
        // is uncertain ownership even if subsequent browser shutdown succeeds.
        await Promise.allSettled(this.openings.map(opening => this.bounded(opening.promise, 'pending browser page')));
        if (this.openings.some(opening => !opening.settled)) this.record(new Error('Browser page creation did not settle during cleanup.'));
        for (const tab of this.tabs) this.release(tab);
        if (this.failure) throw this.failure;
    }
}

module.exports = { BrowserPages };
