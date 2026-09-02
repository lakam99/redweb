'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { verify } = require('./verify');

async function validate() {
    const results = [];
    const cases = [
        ['', null], ['event-inputs', null], ['change-inputs', null], ['lazy-asset', null],
        ['local-counter', 'shared-server-counter'], ['draft-loss', 'draft-preservation'],
        ['unsafe-html', 'literal-message-safety'], ['stale-presence', 'disconnect-presence'],
        ['http-updates', 'shared-server-counter'],
        ['wildcard-bind', 'loopback-binding'],
        ['early-sse', 'http-and-two-tabs'],
    ];
    for (const [fault, expectedFailure] of cases) {
        const result = await verify(path.join(__dirname, 'fixtures'), {
            skipBuild: true, entry: 'app.js', environment: { EVALUATION_FAULT: fault },
        });
        results.push({ fault: fault || 'working-control', expectedFailure, result });
        assert.equal(result.passed, !expectedFailure, JSON.stringify(result));
        assert.equal(result.checks.find(check => !check.passed)?.name ?? null, expectedFailure, JSON.stringify(result));
        assert.equal(result.cleanupError, undefined);
        if (expectedFailure !== 'loopback-binding') assert.ok(result.browser.browserVersions.length > 0, 'Missing actual browser version on a failed or successful check.');
        console.log(`${fault || 'working-control'}: ${expectedFailure ? `correctly rejected at ${expectedFailure}` : 'passed all checks'}`);
    }
    return results;
}
if (require.main === module) validate().then(results => {
    if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), JSON.stringify(results, null, 2) + '\n', { flag: 'wx' });
}).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { validate };
