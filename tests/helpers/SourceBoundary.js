'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');

/** Test-only authored-source VM map shared by explicit boundary fixtures. */
class SourceBoundary {
    constructor(script) {
        this.script = script;
        this.filename = path.resolve(__dirname, '../..', script);
        this.source = fs.readFileSync(this.filename, 'utf8');
        this.require = createRequire(this.filename);
        const instrumenter = createInstrumenter();
        this.compiled = instrumenter.instrumentSync(this.source, this.filename);
        this.expected = instrumenter.lastFileCoverage();
    }

    execute(context) {
        context.__boundaryCompletion = vm.runInNewContext(this.compiled, context, { filename: this.filename });
        return context;
    }

    collect(context) {
        assert.equal(fs.readFileSync(this.filename, 'utf8'), this.source, 'Measured source changed');
        const measured = context.__coverage__[this.filename];
        for (const candidate of [measured, globalThis.__coverage__?.[this.filename]].filter(Boolean)) {
            for (const field of ['statementMap', 'fnMap', 'branchMap']) {
                assert.deepEqual(JSON.parse(JSON.stringify(candidate[field])), JSON.parse(JSON.stringify(this.expected[field])));
            }
        }
        if (process.argv.includes(`--collectCoverageFrom=${this.script}`)) {
            const map = createCoverageMap(globalThis.__coverage__ || {});
            map.merge({ [this.filename]: measured });
            globalThis.__coverage__ ||= {};
            globalThis.__coverage__[this.filename] = map.fileCoverageFor(this.filename).toJSON();
        }
    }
}

module.exports = { SourceBoundary };
