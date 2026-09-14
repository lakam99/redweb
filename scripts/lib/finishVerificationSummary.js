'use strict';

const { verificationError } = require('./verificationError');

/** Publish a terminal outcome; a recording failure never becomes command success. */
function finishVerificationSummary(summary, persist, failure, successStatus) {
    summary.status = failure ? 'failed' : successStatus;
    summary.finishedAt = new Date().toISOString();
    if (failure) summary.error = failure.message;
    const record = value => {
        const error = verificationError(value);
        const retainedWorkspace = failure?.retainedWorkspace;
        failure = failure ? new AggregateError([failure, error], failure.message, { cause: failure }) : error;
        if (retainedWorkspace) failure.retainedWorkspace = retainedWorkspace;
        summary.status = 'failed';
        summary.error = failure.message;
    };
    try { persist(); }
    catch (error) {
        record(error);
        // Best effort, once: correct a previously written summary when possible.
        // An unwritable filesystem may still leave partial/stale evidence.
        try { persist(); } catch (error) { record(error); }
    }
    if (failure) throw failure;
}

module.exports = { finishVerificationSummary };
