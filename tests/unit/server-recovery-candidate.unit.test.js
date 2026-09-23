'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { outputRecorder } = require('../../scripts/diagnostics/recovery-split.cjs');
const { ServerRecoveryCandidate, fingerprint, createDirectory } = require('../../scripts/lib/ServerRecoveryCandidate');
const { evidence } = require('../fixtures/server-recovery-evidence.cjs');

test('candidate finalization validates actual log files and retains synthetic unit evidence exclusively', () =>
    new VerificationWorkspace().run(async owner => {
        const candidate = new ServerRecoveryCandidate(owner.directory);
        candidate.report = { ...candidate.report, ...evidence(), sourceHashes: fingerprint() };
        const output = outputRecorder(owner.directory);
        const result = candidate.finish(output, []);
        expect(result.candidatePassed).toBe(true);
        const file = path.join(owner.directory, 'report.json');
        const before = fs.readFileSync(file, 'utf8');
        expect(JSON.parse(before).candidateOnly).toBe(true);
        expect(() => candidate.finish(output, [])).toThrow(AggregateError);
        expect(fs.readFileSync(file, 'utf8')).toBe(before);
    }));

test.each(['primary', 'provenance', 'output', 'policy', 'missing-output'])(
    'finalization preserves failure and partial evidence (%s)', mode => new VerificationWorkspace().run(async owner => {
        const candidate = new ServerRecoveryCandidate(owner.directory);
        candidate.report = { ...candidate.report, ...evidence(), sourceHashes: fingerprint() };
        const output = mode === 'missing-output' ? undefined : outputRecorder(owner.directory);
        const primary = new Error('Original worker failure');
        const failures = mode === 'primary' ? [primary] : [];
        if (mode === 'provenance') candidate.report.sourceHashes['index.js'] = '0'.repeat(64);
        if (mode === 'output') fs.appendFileSync(path.join(owner.directory, 'server.stdout.log'), 'corruption');
        if (mode === 'policy') candidate.report.samples.pop();
        let thrown;
        try { candidate.finish(output, failures); } catch (error) { thrown = error; }
        expect(thrown).toBeInstanceOf(AggregateError);
        if (mode === 'primary') expect(thrown.errors[0]).toBe(primary);
        const saved = JSON.parse(fs.readFileSync(path.join(owner.directory, 'report.json'), 'utf8'));
        expect(saved.errors.length).toBeGreaterThan(0);
        expect(saved.samples).toEqual(candidate.report.samples);
    }));

test('a real output acquisition failure is retained without starting any worker', () =>
    new VerificationWorkspace().run(async owner => {
        fs.writeFileSync(path.join(owner.directory, 'server.stdout.log'), 'existing');
        const candidate = new ServerRecoveryCandidate(owner.directory);
        await expect(candidate.run()).rejects.toThrow(AggregateError);
        const saved = JSON.parse(fs.readFileSync(path.join(owner.directory, 'report.json'), 'utf8'));
        expect(saved.samples).toEqual([]);
        expect(saved.candidatePassed).toBe(false);
        expect(saved.errors[0]).toContain('EEXIST');
        expect(saved.errors[1]).toContain('output recording did not start');
        expect(fs.readFileSync(path.join(owner.directory, 'server.stdout.log'), 'utf8')).toBe('existing');
    }));

test('default evidence allocation creates an exclusive empty directory under coverage', () => {
    const directory = createDirectory([]);
    try {
        expect(path.dirname(directory)).toBe(path.resolve(__dirname, '../../coverage'));
        expect(path.basename(directory)).toMatch(/^server-recovery-candidate-/);
        expect(fs.readdirSync(directory)).toEqual([]);
    } finally { fs.rmdirSync(directory); } // Only the newly created empty directory.
});
