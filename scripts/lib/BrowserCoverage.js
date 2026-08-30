'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { verificationError } = require('./verificationError');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');

/** Test-only instrumentation of the exact emitted browser source, not its generator. */
class BrowserCoverage {
    constructor(filename, source) {
        this.filename = filename;
        this.source = source;
        this.sha256 = createHash('sha256').update(source).digest('hex');
        const instrumenter = createInstrumenter({ coverageVariable: '__redwebBrowserCoverage__', esModules: true,
            coverageGlobalScope: 'globalThis', coverageGlobalScopeFunc: false });
        this.instrumented = instrumenter.instrumentSync(source, filename);
        // CDP transports coverage as JSON, omitting undefined location fields.
        this.map = createCoverageMap(JSON.parse(JSON.stringify({ [filename]: instrumenter.lastFileCoverage() })));
        assert.ok(Object.keys(this.map.fileCoverageFor(filename).s).length, 'Browser coverage requires executable statements');
    }

    collect(coverage) {
        assert.deepEqual(Object.keys(coverage), [this.filename], 'Expected exactly the instrumented browser module');
        const initial = this.map.fileCoverageFor(this.filename);
        const candidate = coverage[this.filename];
        for (const field of ['statementMap', 'fnMap', 'branchMap']) {
            assert.deepEqual(candidate[field], initial[field], `Browser coverage ${field} differs from emitted source`);
        }
        this.map.merge(coverage);
    }

    report() {
        return { sourceSha256: this.sha256, source: this.filename, summary: this.map.getCoverageSummary().toJSON(), coverage: this.map.toJSON() };
    }

    assertComplete() {
        const summary = this.report().summary;
        for (const metric of ['statements', 'branches', 'functions', 'lines']) {
            assert.equal(summary[metric].pct, 100, `Generated browser ${metric} coverage must be 100%`);
        }
    }

    async verify(operation) {
        let failure;
        try { await operation(); this.assertComplete(); }
        catch (error) { failure = verificationError(error); }
        return {
            failure,
            report: { ...this.report(), status: failure ? 'failed' : 'passed', error: failure?.message, retainedWorkspace: failure?.retainedWorkspace },
        };
    }
}

module.exports = BrowserCoverage;
