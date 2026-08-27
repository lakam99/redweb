class TaskQueue {
    constructor(maxPending, onError = () => {}, errorContext) {
        if (!Number.isInteger(maxPending) || maxPending < 1) {
            throw new TypeError('`maxPending` must be a positive integer.');
        }
        if (typeof onError !== 'function') throw new TypeError('`onError` must be a function.');
        this.maxPending = maxPending;
        this.onError = onError;
        this.errorContext = errorContext;
        this.tasks = [];
        this.running = false;
        this.closed = false;
        this.idleWaiters = [];
    }

    enqueue(task) {
        if (typeof task !== 'function') throw new TypeError('Queued tasks must be functions.');
        if (this.closed || this.tasks.length >= this.maxPending) return false;
        this.tasks.push(task);
        if (!this.running) void this.drain();
        return true;
    }

    async drain() {
        this.running = true;
        while (!this.closed && this.tasks.length) {
            const task = this.tasks.shift();
            try {
                await task();
            } catch (error) {
                try {
                    await this.onError.call(this.errorContext, error);
                } catch {
                    // Error reporting must never interrupt queue cleanup.
                }
            }
        }
        this.running = false;
        this.resolveIdle();
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        this.tasks.length = 0;
        if (!this.running) this.resolveIdle();
    }

    whenIdle() {
        if (!this.running && !this.tasks.length) return Promise.resolve();
        return new Promise(resolve => this.idleWaiters.push(resolve));
    }

    resolveIdle() {
        const waiters = this.idleWaiters.splice(0);
        waiters.forEach(resolve => resolve());
    }

    get pending() {
        return this.tasks.length + (this.running ? 1 : 0);
    }
}

module.exports = TaskQueue;
