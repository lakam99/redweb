'use strict';

const assert = require('node:assert/strict');

/** Validate one exact source map and its execution counters without mutating it. */
function assertCoverageFile(candidate, expected, scope) {
    assert.equal(candidate.path, expected.path, `${scope} coverage path differs`);
    for (const field of ['statementMap', 'fnMap', 'branchMap']) {
        assert.deepEqual(candidate[field], expected[field], `${scope} coverage ${field} differs from source`);
    }
    for (const field of ['s', 'f', 'b']) {
        assert.deepEqual(Object.keys(candidate[field]), Object.keys(expected[field]), `${scope} coverage counters differ`);
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

module.exports = { assertCoverageFile };
