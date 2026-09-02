'use strict';

const pending = new WeakMap();

/** Preserve synchronous constructor errors while letting async owners await rollback. */
function scheduleStartupCleanup(error, cleanup) {
    const failure = error instanceof Error ? error : new Error('Application construction failed.', { cause: error });
    const previous = pending.get(failure);
    const rollback = Promise.resolve(previous).then(() => [], error => [error]).then(async errors => {
        try { await cleanup(); } catch (error) { errors.push(error); }
        if (errors.length) throw new AggregateError(errors, 'Construction rollback failed.');
    });
    pending.set(failure, rollback);
    // Synchronous callers cannot await a constructor; async owners inspect the original task.
    rollback.catch(() => {});
    return failure;
}

function awaitStartupCleanup(error) { return pending.get(error); }

module.exports = { scheduleStartupCleanup, awaitStartupCleanup };
