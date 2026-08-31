'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { verificationError } = require('./verificationError');

/** Keep available evidence independently of copying or report-write failures. */
function preservePackedBrowserReport(report, directory, coverageDirectory, failure) {
    const record = error => {
        error = verificationError(error);
        failure = failure ? new AggregateError([failure, error], failure.message, { cause: failure }) : error;
    };
    const updateStatus = () => {
        if (failure) { report.status = 'failed'; report.error = failure.message; }
    };
    try {
        if (fs.existsSync(coverageDirectory)) fs.cpSync(coverageDirectory, path.join(directory, 'coverage'), { recursive: true });
    } catch (error) { record(error); }
    updateStatus();
    try { fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
    catch (error) { record(error); updateStatus(); }
    return failure;
}

module.exports = { preservePackedBrowserReport };
