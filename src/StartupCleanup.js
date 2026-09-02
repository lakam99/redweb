'use strict';

const pending = new WeakMap();
const { isNativeError } = require('node:util').types;

/** Preserve synchronous constructor errors while letting async owners await rollback. */
function scheduleStartupCleanup(error, cleanup) {
    const failure = error instanceof Error || isNativeError(error) ? error : new Error('Application construction failed.', { cause: error });
    const previous = pending.get(failure);
    // Each partially constructed owner must start releasing its resources even
    // when another owner's cleanup stalls. Retain every failure for the caller.
    const rollback = Promise.allSettled([previous, Promise.resolve().then(cleanup)]).then(results => {
        const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
        if (errors.length) throw new AggregateError(errors, 'Construction rollback failed.');
    });
    pending.set(failure, rollback);
    // Synchronous callers cannot await a constructor; async owners inspect the original task.
    rollback.catch(() => {});
    return failure;
}

function awaitStartupCleanup(error) { return pending.get(error); }

module.exports = { scheduleStartupCleanup, awaitStartupCleanup };
