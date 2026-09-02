'use strict';

const fs = require('node:fs');
const { verificationError } = require('./verificationError');

/** Retain available report bytes before parsing or owned-workspace cleanup. */
async function reportCommand(execution, args, options, source, destination) {
    let result, failure;
    try { result = await execution.command(args, options); }
    catch (error) { failure = verificationError(error); }
    try {
        if (fs.existsSync(source)) {
            if (fs.statSync(source).isDirectory()) {
                // Reserve a new root: cpSync alone can merge into stale evidence.
                fs.mkdirSync(destination);
                fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
            } else fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
        }
    } catch (error) {
        failure = failure ? new AggregateError([failure, error], failure.message, { cause: failure }) : error;
    }
    if (failure) throw failure;
    return result;
}

module.exports = { reportCommand };
