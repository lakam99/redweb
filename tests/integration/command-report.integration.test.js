'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { reportCommand } = require('../../scripts/lib/reportCommand');

test.each([[0, false], [7, false], [0, true], [7, true]])('retains the actual child report before workspace cleanup: exit %s directory %s', (code, directory) =>
    new VerificationWorkspace().run(async evidence => {
        const destination = path.join(evidence.directory, 'outcome.json');
        const childWorkspace = new VerificationWorkspace();
        const report = path.join(childWorkspace.directory, directory ? 'workers' : 'outcome.json');
        const outcome = await childWorkspace.run(execution => reportCommand(execution,
            ['-e', `const fs=require('node:fs'); ${directory ? "fs.mkdirSync('workers/nested', { recursive: true });" : ''}
                fs.writeFileSync('${directory ? 'workers/nested/' : ''}outcome.json', JSON.stringify({ success: ${code === 0} })); console.log('actual child'); process.exitCode = ${code};`],
            { timeoutMs: 5000 }, report, destination)).catch(error => error);
        expect(fs.existsSync(childWorkspace.directory)).toBe(false);
        expect(JSON.parse(fs.readFileSync(directory ? path.join(destination, 'nested/outcome.json') : destination, 'utf8'))).toEqual({ success: code === 0 });
        if (code === 0) expect(outcome).toContain('actual child');
        else expect(outcome.message).toContain('command failed (7)');
    }), 30000);

test('a failure before report creation stays a failure without invented evidence', () =>
    new VerificationWorkspace().run(async execution => {
        const destination = path.join(execution.directory, 'retained.json');
        await expect(reportCommand(execution, ['-e', 'process.exitCode=9'], { timeoutMs: 5000 },
            path.join(execution.directory, 'missing.json'), destination)).rejects.toThrow('command failed (9)');
        expect(fs.existsSync(destination)).toBe(false);
    }), 30000);

test.each([[0, false], [7, false], [0, true], [7, true]])('report preservation cannot mask outcome %s or merge prior evidence: directory %s', (code, directory) =>
    new VerificationWorkspace().run(async execution => {
        const destination = path.join(execution.directory, 'retained.json');
        if (directory) fs.mkdirSync(destination);
        const previous = directory ? path.join(destination, 'prior.txt') : destination;
        fs.writeFileSync(previous, 'existing evidence');
        const failure = await reportCommand(execution,
            ['-e', `const fs=require('node:fs'); ${directory ? "fs.mkdirSync('workers');" : ''}
                fs.writeFileSync('${directory ? 'workers/' : ''}outcome.json', '{}'); process.exitCode=${code};`], { timeoutMs: 5000 },
            path.join(execution.directory, directory ? 'workers' : 'outcome.json'), destination).catch(error => error);
        expect(fs.readFileSync(previous, 'utf8')).toBe('existing evidence');
        if (directory) expect(fs.readdirSync(destination)).toEqual(['prior.txt']);
        if (code === 7) {
            expect(failure).toBeInstanceOf(AggregateError);
            expect(failure.message).toContain('command failed (7)');
            expect(failure.errors[1].code).toBe('EEXIST');
        } else expect(failure.code).toBe('EEXIST');
    }), 30000);

test('malformed report bytes survive subsequent parsing failure and workspace removal', () =>
    new VerificationWorkspace().run(async evidence => {
        const destination = path.join(evidence.directory, 'malformed.json');
        const owner = new VerificationWorkspace();
        await expect(owner.run(async execution => {
            await reportCommand(execution, ['-e', "require('node:fs').writeFileSync('report.json', '{broken');"],
                { timeoutMs: 5000 }, path.join(execution.directory, 'report.json'), destination);
            JSON.parse(fs.readFileSync(destination, 'utf8'));
        })).rejects.toBeInstanceOf(SyntaxError);
        expect(fs.existsSync(owner.directory)).toBe(false);
        expect(fs.readFileSync(destination, 'utf8')).toBe('{broken');
    }), 30000);
