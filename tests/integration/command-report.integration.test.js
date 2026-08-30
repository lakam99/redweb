'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { reportCommand } = require('../../scripts/lib/reportCommand');

test.each([0, 7])('retains the actual child report before workspace cleanup on exit %s', code =>
    new VerificationWorkspace().run(async evidence => {
        const destination = path.join(evidence.directory, 'outcome.json');
        const childWorkspace = new VerificationWorkspace();
        const report = path.join(childWorkspace.directory, 'outcome.json');
        const outcome = await childWorkspace.run(execution => reportCommand(execution,
            ['-e', `require('node:fs').writeFileSync('outcome.json', JSON.stringify({ success: ${code === 0} })); console.log('actual child'); process.exitCode = ${code};`],
            {}, report, destination)).catch(error => error);
        expect(fs.existsSync(childWorkspace.directory)).toBe(false);
        expect(JSON.parse(fs.readFileSync(destination, 'utf8'))).toEqual({ success: code === 0 });
        if (code === 0) expect(outcome).toContain('actual child');
        else expect(outcome.message).toContain('command failed (7)');
    }));

test('a failure before report creation stays a failure without invented evidence', () =>
    new VerificationWorkspace().run(async execution => {
        const destination = path.join(execution.directory, 'retained.json');
        await expect(reportCommand(execution, ['-e', 'process.exitCode=9'], {},
            path.join(execution.directory, 'missing.json'), destination)).rejects.toThrow('command failed (9)');
        expect(fs.existsSync(destination)).toBe(false);
    }));

test.each([0, 7])('report preservation failure cannot mask command outcome %s or overwrite prior evidence', code =>
    new VerificationWorkspace().run(async execution => {
        const destination = path.join(execution.directory, 'retained.json');
        fs.writeFileSync(destination, 'existing evidence');
        const failure = await reportCommand(execution,
            ['-e', `require('node:fs').writeFileSync('outcome.json', '{}'); process.exitCode=${code};`], {},
            path.join(execution.directory, 'outcome.json'), destination).catch(error => error);
        expect(fs.readFileSync(destination, 'utf8')).toBe('existing evidence');
        if (code === 7) {
            expect(failure).toBeInstanceOf(AggregateError);
            expect(failure.message).toContain('command failed (7)');
            expect(failure.errors[1].code).toBe('EEXIST');
        } else expect(failure.code).toBe('EEXIST');
    }));
