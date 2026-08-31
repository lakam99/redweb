'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { captureSoakCommand } = require('../helpers/SoakCommandEvidence');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');

const boundary = exercise => new VerificationWorkspace().run(owner => {
    const report = path.join(owner.directory, 'raw.json');
    const directory = path.join(owner.directory, 'retained');
    const evidence = () => {
        const files = fs.readdirSync(directory);
        expect(files).toHaveLength(1);
        return JSON.parse(fs.readFileSync(path.join(directory, files[0]), 'utf8'));
    };
    return exercise({ owner, report, directory, evidence });
});

test.each([0, 1])('raw evidence precedes parsing and assertions for actual command exit %s', exitCode => boundary(async ({ owner, report, directory, evidence }) => {
    const raw = '{deliberately invalid JSON\n';
    const command = () => owner.command(['-e', 'require("fs").writeFileSync(process.argv[1],process.argv[2]);process.stdout.write(process.argv[2]);process.exitCode=Number(process.argv[3])', report, raw, String(exitCode)], { timeoutMs: 10000 });
    const result = await captureSoakCommand(owner, command, report, directory);
    expect(result).toEqual({ output: raw, rawReport: raw, exitCode });
    expect(() => JSON.parse(result.rawReport)).toThrow();
    expect(evidence()).toMatchObject({ output: raw, rawReport: raw, exitCode });
    expect(evidence().commandError === null).toBe(exitCode === 0);
}), 40000); // Command deadline plus independent process/pipe/filesystem cleanup.

test('an actual different exit remains a failure with available raw evidence', () => boundary(async ({ owner, report, directory, evidence }) => {
    await expect(captureSoakCommand(owner, () => owner.command(['-e', 'process.stderr.write("failed before report");process.exitCode=2'], { timeoutMs: 10000 }), report, directory))
        .rejects.toThrow('Package verification command failed (2)');
    expect(evidence()).toMatchObject({ exitCode: null, output: null, rawReport: null });
    expect(evidence().commandError).toContain('failed before report');
}), 40000);

test('missing raw output is retained as missing, never fabricated from stdout', () => boundary(async ({ owner, report, directory, evidence }) => {
    expect(await captureSoakCommand(owner, async () => 'output only', report, directory))
        .toEqual({ output: 'output only', exitCode: 0, rawReport: null });
    expect(evidence().rawReport).toBeNull();
}));

test('a raw-report read failure is recorded and retains its owner', () => boundary(async ({ owner, report, directory, evidence }) => {
    fs.mkdirSync(report);
    try {
        const failure = await owner.run(() => captureSoakCommand(owner, async () => 'output', report, directory)).catch(error => error);
        expect(failure.retainedWorkspace).toBe(owner.directory);
        expect(evidence().evidenceErrors).toHaveLength(1);
        expect(evidence().rawReport).toBeNull();
    } finally { owner.cleanupFailure = null; } // The outer fixture owns test-only cleanup after the retention assertions.
}));

test.each(['success', 'exit-one', 'primary'])('retention failure preserves the %s outcome and raw file after owner rejection', mode => boundary(async ({ owner, report, directory }) => {
    fs.writeFileSync(directory, 'a real file blocks directory creation');
    fs.writeFileSync(report, 'original raw report');
    const primary = new Error(mode === 'exit-one' ? 'Package verification command failed (1): \n{}' : 'original command failure');
    try {
        const failure = await owner.run(() => captureSoakCommand(owner, async () => { if (mode !== 'success') throw primary; return '{}'; }, report, directory)).catch(error => error);
        expect(failure.retainedWorkspace).toBe(owner.directory);
        expect(fs.readFileSync(report, 'utf8')).toBe('original raw report');
        if (mode === 'success') expect(failure.code).toBe('EEXIST');
        else {
            expect(failure).toBeInstanceOf(AggregateError);
            expect(failure.errors).toHaveLength(2);
            expect(failure.errors[0]).toBe(primary);
            expect(failure.cause).toBe(primary);
            expect(failure.errors[1].code).toBe('EEXIST');
        }
    } finally { owner.cleanupFailure = null; } // Deliberately clean this test's retained owner, only after assertions.
}));

test('falsy command failure remains the primary failure', () => boundary(async ({ owner, report, directory, evidence }) => {
    const failure = await captureSoakCommand(owner, async () => { throw 0; }, report, directory).catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.cause).toBe(0);
    expect(evidence().commandError).toBe('0');
}));
