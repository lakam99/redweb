'use strict';

const fs = require('node:fs');
const { verificationError } = require('./verificationError');

/** Retain a command's available report before its owned workspace is cleaned. */
async function reportCommand(execution, args, options, source, destination) {
    let result, failure;
    try { result = await execution.command(args, options); }
    catch (error) { failure = verificationError(error); }
    try {
        if (fs.existsSync(source)) fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    } catch (error) {
        failure = failure ? new AggregateError([failure, error], failure.message, { cause: failure }) : error;
    }
    if (failure) throw failure;
    return result;
}

module.exports = { reportCommand };
