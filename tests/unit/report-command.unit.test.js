'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');

// Explicit copy/command fault units; native subprocess/filesystem cases are separate.
test.each(['success', 'command', 'copy', 'combined'])('directory report unit: %s', async mode => {
    const events = [];
    const copyFailure = new Error('partial directory copy failed');
    let reportCommand;
    try {
        jest.isolateModules(() => {
            jest.doMock('node:fs', () => ({
                existsSync: () => true,
                statSync: () => ({ isDirectory: () => true }),
                mkdirSync: destination => { expect(destination).toBe('retained'); events.push('reserve'); },
                cpSync: (source, destination, options) => {
                    expect([source, destination]).toEqual(['workers', 'retained']);
                    expect(options).toEqual({ recursive: true, errorOnExist: true, force: false });
                    events.push('copy');
                    if (['copy', 'combined'].includes(mode)) throw copyFailure;
                },
            }));
            ({ reportCommand } = require('../../scripts/lib/reportCommand'));
        });
        const execution = { command: async (args, options) => {
            expect(args).toEqual(['test']); expect(options).toEqual({ timeoutMs: 5000 });
            events.push('command');
            if (['command', 'combined'].includes(mode)) throw 'primary command failed';
            return 'actual output';
        } };
        const outcome = await reportCommand(execution, ['test'], { timeoutMs: 5000 }, 'workers', 'retained').catch(error => error);
        expect(events).toEqual(['command', 'reserve', 'copy']);
        if (mode === 'success') expect(outcome).toBe('actual output');
        else if (mode === 'copy') expect(outcome).toBe(copyFailure);
        else {
            expect(outcome).toBeInstanceOf(Error);
            expect(outcome.message).toBe('primary command failed');
            if (mode === 'combined') {
                expect(outcome).toBeInstanceOf(AggregateError);
                expect(outcome.errors).toEqual([outcome.cause, copyFailure]);
            }
        }
    } finally { jest.dontMock('node:fs'); jest.resetModules(); }
});

test('a mid-copy fault retains partial bytes but cannot reuse the destination', () =>
    new VerificationWorkspace().run(async owner => {
        const { reportCommand } = require('../../scripts/lib/reportCommand');
        const source = path.join(owner.directory, 'workers');
        const destination = path.join(owner.directory, 'retained');
        fs.mkdirSync(source);
        fs.writeFileSync(path.join(source, 'first.json'), '{partial');
        fs.writeFileSync(path.join(source, 'second.json'), '{}');
        const primary = new Error('command failed'), copyFailure = new Error('copy interrupted');
        const copy = jest.spyOn(fs, 'cpSync').mockImplementationOnce((from, to) => {
            fs.copyFileSync(path.join(from, 'first.json'), path.join(to, 'first.json'));
            throw copyFailure;
        });
        try {
            const failure = await reportCommand({ command: async () => { throw primary; } }, [], {}, source, destination).catch(error => error);
            expect(failure).toBeInstanceOf(AggregateError);
            expect(failure.errors).toEqual([primary, copyFailure]);
            expect(failure.cause).toBe(primary);
            expect(fs.readdirSync(destination)).toEqual(['first.json']);
            expect(fs.readFileSync(path.join(destination, 'first.json'), 'utf8')).toBe('{partial');
            await expect(reportCommand({ command: async () => 'success' }, [], {}, source, destination)).rejects.toMatchObject({ code: 'EEXIST' });
            expect(copy).toHaveBeenCalledTimes(1);
            expect(fs.readdirSync(destination)).toEqual(['first.json']);
        } finally { copy.mockRestore(); }
    }), 30000);
