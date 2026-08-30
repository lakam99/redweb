'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const ts = require('typescript');

/** Instruments authored TypeScript before compiler-generated decorator helpers exist. */
class ApplicationCoverage {
    constructor(sources, compilerOptions) {
        assert.ok(Object.keys(sources).length, 'Application coverage needs source modules');
        this.compiled = {};
        this.sources = {};
        this.map = createCoverageMap({});
        for (const [filename, source] of Object.entries(sources)) {
            assert.ok(!/istanbul\s+ignore/.test(source), 'Authored coverage exclusions are not permitted');
            const instrumenter = createInstrumenter({
                parserPlugins: ['typescript', 'jsx', ['decorators', { decoratorsBeforeExport: true }]],
                coverageVariable: '__redwebApplicationCoverage__', coverageGlobalScope: 'globalThis', coverageGlobalScopeFunc: false,
            });
            const instrumented = instrumenter.instrumentSync(source, filename);
            const coverage = JSON.parse(JSON.stringify(instrumenter.lastFileCoverage()));
            assert.ok(Object.keys(coverage.statementMap).length, 'Every application module needs executable statements');
            this.map.addFileCoverage(coverage);
            const output = ts.transpileModule(instrumented, { fileName: filename,
                compilerOptions: { ...compilerOptions, sourceMap: false, inlineSourceMap: false }, reportDiagnostics: true });
            assert.equal(output.diagnostics.length, 0, 'Instrumented TypeScript must transpile without diagnostics');
            this.compiled[filename] = output.outputText;
            this.sources[filename] = createHash('sha256').update(source).digest('hex');
        }
    }

    collect(report) {
        for (const [filename, candidate] of Object.entries(report)) {
            assert.ok(Object.hasOwn(this.sources, filename), 'Unexpected application coverage module');
            const expected = this.map.fileCoverageFor(filename).toJSON();
            assert.equal(candidate.path, filename, 'Application coverage path differs');
            for (const field of ['statementMap', 'fnMap', 'branchMap']) {
                assert.deepEqual(candidate[field], expected[field], `Application coverage ${field} differs from source`);
            }
            for (const field of ['s', 'f', 'b']) {
                assert.deepEqual(Object.keys(candidate[field]), Object.keys(expected[field]), 'Application coverage counters differ');
                for (const key of Object.keys(expected[field])) {
                    const count = candidate[field][key];
                    if (field === 'b') {
                        assert.ok(Array.isArray(count), 'Branch counters must be arrays');
                        assert.equal(count.length, expected[field][key].length, 'Branch counter arity differs');
                    }
                    for (const value of field === 'b' ? count : [count]) {
                        assert.ok(Number.isSafeInteger(value) && value >= 0, 'Coverage counters must be nonnegative safe integers');
                    }
                }
            }
        }
        // Validate the complete report before committing any of its counters.
        this.map.merge(report);
    }

    report() {
        return { sources: this.sources, summary: this.map.getCoverageSummary().toJSON(), coverage: this.map.toJSON() };
    }

    assertComplete() {
        for (const [metric, result] of Object.entries(this.report().summary)) {
            if (['statements', 'branches', 'functions', 'lines'].includes(metric)) {
                assert.equal(result.pct, 100, `Authored application ${metric} coverage must be 100%`);
            }
        }
    }
}

module.exports = ApplicationCoverage;
