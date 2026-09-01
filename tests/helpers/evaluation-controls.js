'use strict';

const assert = require('node:assert/strict');

// Independent expected outcomes for the frozen validator's real protocol controls.
const outcomes = {
    'working-control': null,
    'event-inputs': null,
    'change-inputs': null,
    'lazy-asset': null,
    'local-counter': 'shared-server-counter',
    'draft-loss': 'draft-preservation',
    'unsafe-html': 'literal-message-safety',
    'stale-presence': 'disconnect-presence',
    'http-updates': 'shared-server-counter',
    'wildcard-bind': 'loopback-binding',
    'early-sse': 'http-and-two-tabs',
};

/** A failed control is expected here only for a clean unsupported-platform refusal. */
function assertUnsupportedControlFailure(failure) {
    try {
        assert.ok(failure instanceof Error && !(failure instanceof AggregateError));
        assert.match(failure.message, /^Package verification command failed \(1\): \n/);
        assert.equal(failure.cause, undefined);
        const match = failure.message.match(/^AssertionError \[ERR_ASSERTION\]: (\{[^\r\n]+\})\r?$/m);
        assert.ok(match, 'Missing structured validator refusal');
        const report = JSON.parse(match[1]);
        const reason = 'Independent listener-interface inspection currently requires Windows; do not claim loopback verification on this platform.';
        assert.equal(report.passed, false);
        assert.equal(report.error, reason);
        assert.equal(report.cleanupError, undefined);
        assert.equal(report.causes, undefined);
        assert.equal(report.checks.length, 1);
        assert.equal(report.checks[0].name, 'loopback-binding');
        assert.equal(report.checks[0].passed, false);
        assert.equal(report.checks[0].error, reason);
    } catch (assertion) {
        throw new AggregateError([failure, assertion], 'Expected a clean unsupported-platform refusal', { cause: failure });
    }
}

module.exports = { outcomes, assertUnsupportedControlFailure };
