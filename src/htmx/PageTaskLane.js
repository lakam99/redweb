'use strict';

/** Serializes all browser work for one live page, regardless of transport. */
class PageTaskLane {
    constructor(maxPending = 64) {
        this.maxPending = maxPending;
        this.tasks = [];
        this.running = false;
        this.closed = false;
    }

    enqueue(task) {
        if (typeof task !== 'function') throw new TypeError('Page tasks must be functions.');
        if (this.closed || this.tasks.length + (this.running ? 1 : 0) >= this.maxPending) return null;
        let resolve, reject;
        const result = new Promise((accept, deny) => { resolve = accept; reject = deny; });
        this.tasks.push({ task, resolve, reject });
        if (!this.running) void this.drain();
        return result;
    }

    async drain() {
        this.running = true;
        while (!this.closed && this.tasks.length) {
            const current = this.tasks.shift();
            try { current.resolve(await current.task()); }
            catch (error) { current.reject(error); }
        }
        this.running = false;
    }

    close(error = new Error('Page task lane closed.')) {
        if (this.closed) return;
        this.closed = true;
        this.tasks.splice(0).forEach(task => task.reject(error));
    }
}

module.exports = PageTaskLane;
