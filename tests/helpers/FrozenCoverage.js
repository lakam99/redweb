'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');

/** Test-only original-filename instrumentation; frozen files are never replaced. */
class FrozenCoverage {
    constructor(directory, script) {
        this.script = script;
        this.filename = path.resolve(__dirname, '../..', script);
        this.source = fs.readFileSync(this.filename, 'utf8');
        this.reports = path.join(directory, 'coverage-processes');
        fs.mkdirSync(this.reports);
        const compiled = path.join(directory, 'coverage-compiled.json');
        const instrumenter = createInstrumenter({ coverageVariable: '__redwebApplicationCoverage__',
            coverageGlobalScope: 'globalThis', coverageGlobalScopeFunc: false });
        fs.writeFileSync(compiled, JSON.stringify({ [this.filename]: instrumenter.instrumentSync(this.source, this.filename) }));
        this.expected = instrumenter.lastFileCoverage();
        this.environment = {
            NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ${JSON.stringify(path.join(__dirname, 'instrument-selected.cjs'))}`,
            REDWEB_COVERAGE_COMPILED: compiled, REDWEB_APPLICATION_COVERAGE_DIRECTORY: this.reports,
        };
    }

    collect() {
        assert.equal(fs.readFileSync(this.filename, 'utf8'), this.source, 'Frozen source changed');
        const files = fs.readdirSync(this.reports);
        assert.equal(files.length, 1, 'Expected one actual instrumented CLI process');
        const measured = JSON.parse(fs.readFileSync(path.join(this.reports, files[0]), 'utf8'));
        assert.deepEqual(Object.keys(measured), [this.filename]);
        for (const field of ['statementMap', 'fnMap', 'branchMap']) {
            assert.deepEqual(measured[this.filename][field], JSON.parse(JSON.stringify(this.expected[field])));
        }
        if (process.argv.includes(`--collectCoverageFrom=${this.script}`)) {
            const map = createCoverageMap(globalThis.__coverage__ || {}); map.merge(measured);
            globalThis.__coverage__ ||= {};
            globalThis.__coverage__[this.filename] = map.fileCoverageFor(this.filename).toJSON();
        }
    }
}

module.exports = { FrozenCoverage };
