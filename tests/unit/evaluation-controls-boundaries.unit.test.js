'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { withTimeout } = require('../helpers/network');
const { outcomes, assertUnsupportedControlFailure } = require('../helpers/evaluation-controls');
const filename = path.resolve(__dirname, '../../scripts/evaluation/validate.js');

// Explicit verifier-result boundary units; no browser/process success is inferred.
async function boundary(mode, assertion) {
    await new VerificationWorkspace().run(async owner => {
        const calls = [], logs = [], errors = [];
        const reportFile = path.join(owner.directory, 'controls.json');
        if (mode === 'existing-report') fs.writeFileSync(reportFile, 'previous immutable report\n');
        const rejection = new Error('verifier rejected');
        let finish;
        const done = new Promise(resolve => { finish = resolve; });
        const nativeRequire = createRequire(filename);
        const context = { module: { exports: {} }, __dirname: path.dirname(filename),
            process: { argv: ['node', filename, ...(mode === 'no-file' ? [] : [reportFile])] },
            console: { log: line => {
                logs.push(line);
                if (logs.length === Object.keys(outcomes).length) setImmediate(finish);
            }, error: error => { errors.push(error); finish(); } } };
        context.require = name => name === './verify' ? { verify: async (...args) => {
            calls.push(args);
            if (mode === 'rejection') throw rejection;
            const expected = outcomes[args[1].environment.EVALUATION_FAULT || 'working-control'];
            const result = { passed: expected === null,
                checks: [{ name: expected || 'all checks', passed: expected === null }],
                browser: { browserVersions: [{ product: 'unit-boundary-not-a-browser' }] } };
            if (mode === 'wrong-pass') result.passed = !result.passed;
            if (mode === 'wrong-check') result.checks = [{ name: 'unexpected failure', passed: false }];
            if (mode === 'cleanup-error') result.cleanupError = 'uncertain application cleanup';
            if (mode === 'missing-browser') result.browser.browserVersions = [];
            return result;
        } } : nativeRequire(name);
        if (mode !== 'import') context.require.main = context.module;
        vm.runInNewContext(createInstrumenter().instrumentSync(fs.readFileSync(filename, 'utf8'), filename), context, { filename });
        try {
            let results;
            if (mode === 'import') {
                expect(calls).toEqual([]);
                results = await context.module.exports.validate();
            }
            await withTimeout(done, 'unit validator completion', 5000);
            await assertion({ context, calls, logs, errors, reportFile, rejection, results });
        } finally {
            if (process.argv.includes('--collectCoverageFrom=scripts/evaluation/validate.js')) {
                const map = createCoverageMap(globalThis.__coverage__ || {}); map.merge(context.__coverage__);
                globalThis.__coverage__ ||= {}; globalThis.__coverage__[filename] = map.fileCoverageFor(filename).toJSON();
            }
        }
    });
}

test.each(['file', 'no-file', 'import'])('validator %s boundary checks the complete ordered protocol matrix', async mode => {
    await boundary(mode, ({ context, calls, logs, errors, reportFile, results }) => {
        expect(calls).toHaveLength(11);
        expect(errors).toEqual([]);
        expect(context.process.exitCode).toBeUndefined();
        for (const [index, [fault, expected]] of Object.entries(outcomes).entries()) {
            expect(calls[index]).toEqual([path.join(path.dirname(filename), 'fixtures'), {
                skipBuild: true, entry: 'app.js', environment: { EVALUATION_FAULT: index === 0 ? '' : fault },
            }]);
            expect(logs[index]).toBe(`${fault}: ${expected ? `correctly rejected at ${expected}` : 'passed all checks'}`);
        }
        expect(fs.existsSync(reportFile)).toBe(mode === 'file');
        if (mode === 'file') results = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
        if (results) expect(results.map(({ fault, expectedFailure }) => [fault, expectedFailure])).toEqual(Object.entries(outcomes));
    });
});

test.each(['rejection', 'wrong-pass', 'wrong-check', 'cleanup-error', 'missing-browser'])('validator rejects %s without saving a successful matrix', async mode => {
    await boundary(mode, ({ context, calls, logs, errors, reportFile, rejection }) => {
        expect(calls).toHaveLength(1);
        expect(logs).toEqual([]);
        expect(errors).toHaveLength(1);
        expect(context.process.exitCode).toBe(1);
        expect(fs.existsSync(reportFile)).toBe(false);
        if (mode === 'rejection') expect(errors[0]).toBe(rejection);
        else {
            expect(errors[0].name).toBe('AssertionError');
            if (mode === 'cleanup-error') expect(errors[0].message).toContain('uncertain application cleanup');
            if (mode === 'missing-browser') expect(errors[0].message).toContain('Missing actual browser version');
        }
    });
});

test('validator CLI refuses to overwrite an existing report after the complete matrix', async () => {
    await boundary('existing-report', ({ context, calls, logs, errors, reportFile }) => {
        expect(calls).toHaveLength(11);
        expect(logs).toHaveLength(11);
        expect(errors).toHaveLength(1);
        expect(errors[0].code).toBe('EEXIST');
        expect(context.process.exitCode).toBe(1);
        expect(fs.readFileSync(reportFile, 'utf8')).toBe('previous immutable report\n');
    });
});

test.each(['clean', 'timeout', 'cleanup-error', 'aggregate', 'wrong-exit', 'unstructured', 'wrong-check'])
('unsupported-platform oracle distinguishes %s from a clean CLI refusal', mode => {
    const reason = 'Independent listener-interface inspection currently requires Windows; do not claim loopback verification on this platform.';
    const report = { passed: false, error: reason, checks: [{ name: 'loopback-binding', passed: false, error: reason }] };
    if (mode === 'cleanup-error') report.cleanupError = 'process exit timed out';
    if (mode === 'wrong-check') report.checks[0].name = 'http-and-two-tabs';
    const prefix = mode === 'timeout' ? 'package verification command timed out\n' : `Package verification command failed (${mode === 'wrong-exit' ? 2 : 1}): \n`;
    const message = prefix + (mode === 'unstructured' ? reason : `AssertionError [ERR_ASSERTION]: ${JSON.stringify(report)}\n`);
    const failure = mode === 'aggregate' ? new AggregateError([new Error('cleanup failure')], message) : new Error(message);
    if (mode === 'clean') expect(() => assertUnsupportedControlFailure(failure)).not.toThrow();
    else {
        let rejection;
        try { assertUnsupportedControlFailure(failure); } catch (error) { rejection = error; }
        expect(rejection).toBeInstanceOf(AggregateError);
        expect(rejection.cause).toBe(failure);
        expect(rejection.errors[0]).toBe(failure);
        expect(rejection.errors[1].name).toBe('AssertionError');
    }
});
