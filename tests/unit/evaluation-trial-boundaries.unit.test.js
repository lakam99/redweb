'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const { seal } = require('../../scripts/evaluation/seal');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { evaluationFixture, write, retainTrialFailure } = require('../helpers/evaluation-fixture');
const { withTimeout } = require('../helpers/network');
const filename = path.resolve(__dirname, '../../scripts/evaluation/run-trial.js');

// Explicit copy/verifier boundary units. Native CLI/browser/archive tests are separate.
test.each(['passed', 'copy-error', 'verifier-error', 'cleanup-error', 'retained-cleanup'])('trial CLI preserves the %s boundary outcome', async mode => {
    await new VerificationWorkspace().run(async owner => {
        const { evidence, application } = evaluationFixture(owner.directory);
        seal(evidence);
        let finish, execution, verifierCalls = 0;
        const done = new Promise(resolve => { finish = resolve; });
        const nativeRequire = createRequire(filename), boundaryFailure = new Error('unit boundary failure');
        const requireBoundary = name => {
            if (name === 'os') return { tmpdir: () => owner.directory };
            if (name === 'fs' && mode === 'copy-error') return { ...fs, cpSync() { throw boundaryFailure; } };
            if (name === 'fs' && mode === 'cleanup-error') return { ...fs, rmSync(directory, options) {
                if (path.basename(directory).startsWith('evaluation-run-')) throw boundaryFailure;
                return fs.rmSync(directory, options);
            } };
            if (name === './verify') return { verify: async directory => {
                execution = directory; verifierCalls += 1;
                if (mode === 'verifier-error') throw boundaryFailure;
                return mode === 'retained-cleanup'
                    ? { passed: false, error: 'unit primary failure', cleanupError: 'unit cleanup uncertainty' }
                    : { passed: true };
            } };
            return nativeRequire(name);
        };
        const context = { require: requireBoundary, module: { exports: {} }, __dirname: path.dirname(filename),
            process: { argv: ['node', filename, evidence, application] },
            console: { log: output => finish({ output }), error: error => finish({ error }) } };
        requireBoundary.main = context.module;
        vm.runInNewContext(createInstrumenter().instrumentSync(fs.readFileSync(filename, 'utf8'), filename), context, { filename });
        try {
            const outcome = await withTimeout(done, 'unit trial CLI completion', 5000);
            expect(outcome.error).toBeUndefined();
            const report = JSON.parse(outcome.output);
            expect(JSON.parse(fs.readFileSync(path.join(evidence, 'independent-submission-1.json'), 'utf8'))).toEqual(report);
            expect(report.inputs.verifiedInstalledFiles).toBe(1);
            expect(verifierCalls).toBe(mode === 'copy-error' ? 0 : 1);
            expect(context.process.exitCode).toBe(mode === 'passed' ? undefined : 1);
            expect(report.passed).toBe(mode === 'passed');
            if (mode === 'copy-error' || mode === 'verifier-error') {
                expect(report.preparationError).toBe(boundaryFailure.message);
            }
            if (mode === 'retained-cleanup' || mode === 'cleanup-error') {
                expect(report.error).toBe(mode === 'retained-cleanup' ? 'unit primary failure' : undefined);
                expect(report.cleanupError).toBe(mode === 'retained-cleanup' ? 'unit cleanup uncertainty' : boundaryFailure.message);
                expect(report.retainedExecutionDirectory).toBe(execution);
                expect(fs.existsSync(execution)).toBe(true);
            } else {
                expect(report.retainedExecutionDirectory).toBeUndefined();
                expect(fs.readdirSync(owner.directory).filter(name => name.startsWith('evaluation-run-'))).toEqual([]);
            }
        } finally {
            if (process.argv.includes('--collectCoverageFrom=scripts/evaluation/run-trial.js')) {
                const map = createCoverageMap(globalThis.__coverage__ || {}); map.merge(context.__coverage__);
                globalThis.__coverage__ ||= {}; globalThis.__coverage__[filename] = map.fileCoverageFor(filename).toJSON();
            }
        }
    });
});

test.each(['cleanup-error', 'retained-execution', 'unrecorded-execution', 'invalid-report', 'ordinary'])
('native-fixture failure retention preserves %s evidence before outer cleanup', async mode => {
    const owner = new VerificationWorkspace();
    const primary = new Error('original CLI failure');
    const evidence = path.join(owner.directory, 'evidence');
    try {
        const failure = await owner.run(async () => {
            const result = path.join(evidence, 'independent-submission-1.json');
            if (mode === 'cleanup-error') write(result, { passed: false, cleanupError: 'uncertain cleanup' });
            if (mode === 'retained-execution') write(result, { retainedExecutionDirectory: path.join(owner.directory, 'evaluation-run-fixture') });
            if (mode === 'unrecorded-execution') fs.mkdirSync(path.join(owner.directory, 'evaluation-run-fixture'));
            if (mode === 'invalid-report') write(result, '{broken report');
            if (mode === 'ordinary') write(result, { passed: false, error: 'build failed' });
            throw retainTrialFailure(owner, evidence, primary);
        }).catch(error => error);
        expect(failure.message).toBe(primary.message);
        if (mode === 'invalid-report') {
            expect(failure.cause).toBe(primary);
            expect(failure.errors[0]).toBe(primary);
            expect(failure.errors[1]).toBeInstanceOf(SyntaxError);
        } else expect(failure).toBe(primary);
        expect(fs.existsSync(owner.directory)).toBe(mode !== 'ordinary');
        expect(failure.retainedWorkspace).toBe(mode === 'ordinary' ? undefined : owner.directory);
        if (mode === 'cleanup-error') expect(JSON.parse(fs.readFileSync(path.join(evidence, 'independent-submission-1.json'), 'utf8')).cleanupError).toBe('uncertain cleanup');
    } finally {
        // These are synthetic file-only faults: no live process is being rescued.
        await fs.promises.rm(owner.directory, { recursive: true, force: true });
    }
});
