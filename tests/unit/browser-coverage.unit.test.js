'use strict';

const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const BrowserCoverage = require('../../scripts/lib/BrowserCoverage');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { withTimeout } = require('../helpers/network');

const source = 'const choose = value => value ? 1 : 2;';
const snapshot = (coverage, exercise) => {
    const context = vm.createContext({});
    vm.runInContext(coverage.instrumented + exercise, context);
    return JSON.parse(JSON.stringify(context.__redwebBrowserCoverage__));
};

describe('exact generated-source coverage collector', () => {
    test('keeps unexecuted source in the denominator and merges independent executions', () => {
        const coverage = new BrowserCoverage('fixture.js', source);
        expect(coverage.report().sourceSha256).toBe(createHash('sha256').update(source).digest('hex'));
        expect(coverage.report().summary.statements.pct).toBe(0);
        expect(() => coverage.assertComplete()).toThrow('statements');
        coverage.collect(snapshot(coverage, 'choose(true);'));
        expect(coverage.report().summary.branches.pct).toBe(50);
        expect(() => coverage.assertComplete()).toThrow('branches');
        coverage.collect(snapshot(coverage, 'choose(false);'));
        expect(() => coverage.assertComplete()).not.toThrow();
        expect(coverage.report().summary.functions.pct).toBe(100);
    });

    test('rejects missing, extra and altered source entries', () => {
        expect(() => new BrowserCoverage('empty.js', '/* no executable source */')).toThrow('executable statements');
        const coverage = new BrowserCoverage('fixture.js', source);
        expect(() => coverage.collect({})).toThrow('exactly');
        const actual = snapshot(coverage, 'choose(true); choose(false);');
        expect(() => coverage.collect({ ...actual, extra: actual['fixture.js'] })).toThrow('exactly');
        for (const field of ['statementMap', 'fnMap', 'branchMap']) {
            const changed = JSON.parse(JSON.stringify(actual));
            changed['fixture.js'][field] = {};
            expect(() => coverage.collect(changed)).toThrow(field);
        }
        expect(coverage.report().summary.statements.pct).toBe(0);
        coverage.collect(actual);
        coverage.assertComplete();
    });

    test('finalizes status after the full operation and coverage checks settle', async () => {
        const coverage = new BrowserCoverage('fixture.js', source);
        const incomplete = await coverage.verify(async () => {});
        expect(incomplete.report.status).toBe('failed');
        expect(incomplete.failure.message).toContain('statements');
        coverage.collect(snapshot(coverage, 'choose(true); choose(false);'));
        const passed = await coverage.verify(() => new VerificationWorkspace().run(async () => {}));
        expect(passed.report.status).toBe('passed');
        expect(passed.failure).toBeUndefined();
        const execution = new VerificationWorkspace();
        const failed = await coverage.verify(() => execution.run(async context => fs.readFileSync(path.join(context.directory, 'absent'))));
        expect(failed.report.status).toBe('failed');
        expect(failed.report.error).toContain('ENOENT');
        expect(fs.existsSync(execution.directory)).toBe(false);
    });

    test.each([undefined, null, ''])('a thrown non-Error value is still a failed verification (%s)', async value => {
        const coverage = new BrowserCoverage('fixture.js', source);
        const outcome = await coverage.verify(async () => { throw value; });
        expect(outcome.report.status).toBe('failed');
        expect(outcome.failure).toBeInstanceOf(Error);
        expect(outcome.failure.cause).toBe(value);
    });

    (process.platform === 'win32' ? test : test.skip)('a real final-cleanup file lock cannot leave a passing report', async () => {
        const coverage = new BrowserCoverage('fixture.js', source);
        coverage.collect(snapshot(coverage, 'choose(true); choose(false);'));
        const execution = new VerificationWorkspace();
        fs.writeFileSync(path.join(execution.directory, 'locked.txt'), 'actual file');
        const locker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            "$stream=[System.IO.File]::Open('locked.txt','Open','Read','None'); Write-Output 'locked'; [Console]::ReadLine() | Out-Null; $stream.Dispose()"],
        { cwd: execution.directory, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        const closed = new Promise(resolve => locker.once('close', resolve));
        try {
            await withTimeout(new Promise((resolve, reject) => { locker.once('error', reject); locker.stdout.once('data', resolve); }), 'exclusive file lock', 5000);
            const outcome = await coverage.verify(() => execution.run(async () => {}));
            expect(outcome.report.summary.statements.pct).toBe(100);
            expect(outcome.report.status).toBe('failed');
            expect(outcome.report.retainedWorkspace).toBe(execution.directory);
            expect(outcome.report.error).toBe(outcome.failure.message);
            expect(fs.existsSync(execution.directory)).toBe(true);
        } finally {
            locker.stdin.end('\n');
            try { await withTimeout(closed, 'file lock release', 5000); }
            finally {
                if (locker.exitCode === null && locker.signalCode === null) { locker.kill('SIGKILL'); await withTimeout(closed, 'lock process exit', 5000); }
                fs.rmSync(execution.directory, { recursive: true, force: true });
            }
        }
    }, 12000);
});
