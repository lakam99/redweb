'use strict';

class OperationInterrupted extends Error {
    constructor(reason) {
        super('Operation did not complete within its lifetime.');
        this.reason = reason;
    }
}

/** Shared, browser-safe lifetime boundary; it cannot preempt synchronous JS. */
class BoundedOperation {
    constructor(timeoutMs = 5000) {
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) throw new TypeError('Timeout must be an integer between 1 and 2147483647.');
        this.timeoutMs = timeoutMs;
        Object.freeze(this);
    }

    async run(operation, signal) {
        if (signal?.aborted) throw new OperationInterrupted('cancelled');
        let timer, abort;
        const controller = new AbortController();
        const started = performance.now();
        try {
            const interrupted = new Promise((_, reject) => {
                const interrupt = reason => {
                    reject(new OperationInterrupted(reason));
                    controller.abort();
                };
                timer = setTimeout(() => interrupt('timeout'), this.timeoutMs);
                abort = () => interrupt('cancelled');
                signal?.addEventListener('abort', abort, { once: true });
            });
            const work = Promise.resolve().then(async () => {
                if (signal?.aborted) throw new OperationInterrupted('cancelled');
                const value = await operation(controller.signal);
                if (signal?.aborted) throw new OperationInterrupted('cancelled');
                if (performance.now() - started >= this.timeoutMs) throw new OperationInterrupted('timeout');
                return value;
            });
            return await Promise.race([work, interrupted]);
        } catch (error) {
            if (error instanceof OperationInterrupted) controller.abort();
            throw error;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
        }
    }
}

module.exports = { BoundedOperation, OperationInterrupted };
