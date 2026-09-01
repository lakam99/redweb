'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { verificationError } = require('../../scripts/lib/verificationError');

/** Retain raw command evidence before parsing or asserting the soak policy. */
async function captureSoakCommand(owner, command, reportPath, directory) {
    let output = null, exitCode = null, rawReport = null, commandFailure;
    let retentionFailed = false;
    const failures = [];
    try { output = await command(); exitCode = 0; }
    catch (error) {
        commandFailure = verificationError(error);
        // VerificationWorkspace's normal nonzero exit; not timeout/launch/cleanup.
        const prefix = 'Package verification command failed (1): \n';
        if (commandFailure.message.startsWith(prefix)) {
            output = commandFailure.message.slice(prefix.length); exitCode = 1;
        } else failures.push(commandFailure);
    }
    try { rawReport = fs.readFileSync(reportPath, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') { failures.push(error); retentionFailed = true; } }
    try {
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, `${randomUUID()}.json`), JSON.stringify({
            classification: 'ten-second mechanics only; not soak acceptance',
            exitCode, output, rawReport, commandError: commandFailure?.message || null,
            evidenceErrors: failures.filter(error => error !== commandFailure).map(error => error.message),
        }, null, 2), { flag: 'wx' });
    } catch (error) { failures.push(error); retentionFailed = true; }
    if (failures.length) {
        if (commandFailure && !failures.includes(commandFailure)) failures.unshift(commandFailure);
        const failure = failures.length === 1 ? failures[0]
            : new AggregateError(failures, failures[0].message, { cause: failures[0] });
        // The original raw file may be the only surviving evidence. Preserve
        // its owner if reading or retaining it failed, even after run rejects.
        if (retentionFailed) owner.cleanupFailure = failure;
        throw failure;
    }
    return { output, exitCode, rawReport };
}

module.exports = { captureSoakCommand };
