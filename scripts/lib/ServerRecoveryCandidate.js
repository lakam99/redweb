'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const diagnostic = require('../diagnostics/recovery-split.cjs');
const policy = require('./ServerRecoveryPolicy');
const root = path.resolve(__dirname, '../..');

function preflight(environment, flags) {
    assert(Array.isArray(flags) && flags.length === 0, 'Candidate coordinator does not accept Node flags');
    for (const [name, value] of Object.entries(environment)) {
        const key = name.toUpperCase();
        if (key === 'NODE_OPTIONS' || key === 'NODE_V8_COVERAGE' || key.startsWith('REDWEB_RECOVERY_')) {
            assert(!value, `Candidate does not accept ${name}`);
        }
    }
    assert.deepEqual(diagnostic.phases, policy.phases, 'Diagnostic workload differs from candidate contract');
}

function fingerprint() {
    const hashes = diagnostic.fingerprint();
    for (const file of ['scripts/verify-server-recovery.js',
        'scripts/lib/ServerRecoveryCandidate.js', 'scripts/lib/ServerRecoveryPolicy.js']) {
        hashes[file] = createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
    }
    return hashes;
}

/** One owner for candidate evidence; reuse the diagnostic's existing workers. */
class ServerRecoveryCandidate {
    constructor(directory) {
        assert(path.isAbsolute(directory), 'Candidate evidence directory must be absolute');
        this.directory = directory;
        this.report = { candidateOnly: true, candidatePassed: false, protocol: policy.protocol,
            workload: policy.workload, coordinatorPid: process.pid, platform: process.platform,
            architecture: process.arch, startedAt: new Date().toISOString(), sourceHashes: fingerprint(),
            samples: [], deliveryAndCleanupPassed: false, fingerprintPassed: false };
    }

    async run() {
        const failures = [];
        let output;
        try {
            output = diagnostic.outputRecorder(this.directory);
            await diagnostic.run(this.report, sample => {
                fs.appendFileSync(path.join(this.directory, 'samples.ndjson'), `${JSON.stringify(sample)}\n`);
            }, { mode: 'baseline', output: output.write, onWorker: (role, pid) => {
                fs.appendFileSync(path.join(this.directory, 'workers.ndjson'), `${JSON.stringify({ role, pid })}\n`);
            } });
        } catch (error) { failures.push(error); }
        return this.finish(output, failures);
    }

    finish(output, failures) {
        this.report.candidatePassed = false;
        // Every finalization step is attempted; never replace the primary error.
        const attempt = action => {
            try { action(); } catch (error) { failures.push(error); }
        };
        attempt(() => {
            this.report.finalSourceHashes = fingerprint();
            assert.deepEqual(this.report.finalSourceHashes, this.report.sourceHashes, 'Candidate inputs changed');
            this.report.fingerprintPassed = true;
        });
        attempt(() => {
            assert(output, 'Candidate output recording did not start');
            this.report.outputFiles = output.summary();
            assert(Object.values(this.report.outputFiles).every(log => log.complete), 'Candidate output incomplete');
        });
        if (!failures.length) attempt(() => Object.assign(this.report, policy.evaluate(this.report)));
        this.report.endedAt = new Date().toISOString();
        this.report.errors = failures.map(diagnostic.describeFailure);
        attempt(() => fs.writeFileSync(path.join(this.directory, 'report.json'),
            `${JSON.stringify(this.report, null, 2)}\n`, { flag: 'wx' }));
        if (failures.length) throw new AggregateError(failures, 'Server recovery candidate failed; retained evidence is not acceptance');
        return this.report;
    }
}

function createDirectory(args) {
    assert(args.length <= 1, 'Usage: verify-server-recovery.js [new-absolute-evidence-directory]');
    let directory;
    if (args.length) {
        assert(path.isAbsolute(args[0]), 'Candidate evidence directory must be absolute');
        directory = args[0];
        fs.mkdirSync(directory); // Explicit destinations must not already exist.
    } else {
        const parent = path.join(root, 'coverage');
        fs.mkdirSync(parent, { recursive: true });
        directory = fs.mkdtempSync(path.join(parent, 'server-recovery-candidate-'));
    }
    return directory;
}

async function main(args) {
    preflight(process.env, process.execArgv);
    const directory = createDirectory(args);
    process.stdout.write(`Candidate evidence: ${directory}\n`);
    const report = await new ServerRecoveryCandidate(directory).run();
    process.stdout.write(`${JSON.stringify({ candidateOnly: true, candidatePassed: report.candidatePassed,
        protocol: report.protocol, server: report.server, client: report.client, exactReplies: report.exactReplies })}\n`);
    return report;
}

module.exports = { ServerRecoveryCandidate, preflight, fingerprint, createDirectory, main };
