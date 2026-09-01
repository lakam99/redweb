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
        let timer, abort, interruption;
        const controller = new AbortController();
        const started = performance.now();
        const checkpoint = () => {
            if (interruption) throw interruption;
            if (signal?.aborted) throw (interruption = new OperationInterrupted('cancelled'));
            if (performance.now() - started >= this.timeoutMs) throw (interruption = new OperationInterrupted('timeout'));
        };
        try {
            const interrupted = new Promise((_, reject) => {
                const interrupt = reason => {
                    // Timer delivery is itself terminal, even if clock sampling
                    // has not yet reached the nominal deadline. Latch before
                    // abort listeners can reenter a checkpoint.
                    interruption ||= new OperationInterrupted(reason);
                    reject(interruption);
                    controller.abort();
                };
                timer = setTimeout(() => interrupt('timeout'), this.timeoutMs);
                abort = () => interrupt('cancelled');
                signal?.addEventListener('abort', abort, { once: true });
            });
            const work = Promise.resolve().then(async () => {
                checkpoint();
                const value = await operation(controller.signal, checkpoint);
                checkpoint();
                return value;
            });
            return await Promise.race([work, interrupted]);
        } catch (error) {
            if (error instanceof OperationInterrupted) {
                interruption ||= error;
                controller.abort();
            }
            throw error;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
        }
    }
}

module.exports = { BoundedOperation, OperationInterrupted };
