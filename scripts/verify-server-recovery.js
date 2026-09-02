'use strict';

require('./lib/ServerRecoveryCandidate').main(process.argv.slice(2)).then(report => {
    process.exitCode = report.candidatePassed ? 0 : 1;
}).catch(error => {
    process.stderr.write(`${require('./diagnostics/recovery-split.cjs').describeFailure(error)}\n`);
    process.exitCode = 1;
});
