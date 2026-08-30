'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { withTimeout, waitForCondition } = require('../helpers/network');

async function stopDescendant(pid) {
    if (!pid) return;
    try { process.kill(pid); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await waitForCondition(() => {
        try { process.kill(pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; }
    }, 'descendant exit', 5000);
}

test('managed commands preserve literal arguments and remove their owned workspace after success', async () => {
    const execution = new VerificationWorkspace();
    const literal = 'a space; $variable & "quoted"';
    const result = await execution.run(async context => context.command(
        ['-e', 'console.log(process.argv[1]); console.log(process.env.PROBE_MODE);', literal],
        { environment: { PROBE_MODE: 'explicit' } }));
    expect(result).toBe(`${literal}\nexplicit\n`);
    expect(fs.existsSync(execution.directory)).toBe(false);
});

test('command diagnostics retain real nonzero exits and launch failures', async () => {
    const execution = new VerificationWorkspace();
    await execution.run(async context => {
        await expect(context.command(['-e', 'console.error("actual failure"); process.exitCode=7;']))
            .rejects.toThrow('actual failure');
        await expect(context.command(['-e', ''], { cwd: path.join(context.directory, 'absent') }))
            .rejects.toThrow('ENOENT');
    });
});

test('native archive commands use the same owner without shell argument interpretation', async () => {
    await new VerificationWorkspace().run(async execution => {
        expect(await execution.command(['--version'], { executable: 'tar' })).toMatch(/tar/i);
        const archive = 'absent archive; $variable & quoted.tar';
        await expect(execution.command(['-tf', archive], { executable: 'tar' })).rejects.toThrow(archive);
        await expect(execution.command([], { executable: path.join(execution.directory, 'absent-executable') })).rejects.toThrow('ENOENT');
        expect(fs.readdirSync(execution.directory)).toEqual([]);
    });
});

test('verbose children cannot grow captured output without bound', async () => {
    await new VerificationWorkspace().run(async context => {
        const output = await context.command(['-e', 'process.stdout.write("x".repeat(2*1024*1024)); process.stderr.write("y".repeat(2*1024*1024));']);
        expect(output).toHaveLength(1024 * 1024);
        expect(output).toBe('x'.repeat(1024 * 1024));
    });
});

test('timeout terminates the real command and its descendant before directory cleanup', async () => {
    const execution = new VerificationWorkspace();
    let descendant;
    await expect(execution.run(async context => {
        try {
            await context.command(['-e', `const child=require('child_process').spawn(process.execPath,
                ['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
                require('fs').writeFileSync('child.pid',String(child.pid));
                console.error('before timeout'); setInterval(()=>{},1000);`], { timeoutMs: 2000 });
        } finally { descendant = Number(fs.readFileSync(path.join(context.directory, 'child.pid'), 'utf8')); }
    })).rejects.toThrow('before timeout');
    expect(() => process.kill(descendant, 0)).toThrow();
    expect(fs.existsSync(execution.directory)).toBe(false);
}, 12000);

test('successful cleanup preserves the original check failure', async () => {
    const execution = new VerificationWorkspace();
    const original = new Error('original check failure');
    await expect(execution.run(async () => { throw original; })).rejects.toBe(original);
    expect(fs.existsSync(execution.directory)).toBe(false);
});

test.each([undefined, null, false, 0, 'primitive verification failure'])('non-Error failures cannot become successful verification (%s)', async thrown => {
    const execution = new VerificationWorkspace();
    const failure = await execution.run(() => { throw thrown; }).catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toBe(String(thrown));
    expect(failure.cause).toBe(thrown);
    expect(fs.existsSync(execution.directory)).toBe(false);
});

test('failure normalization never invokes object coercion and retains cross-realm native errors', async () => {
    const hostile = { toString() { throw new Error('must not coerce'); } };
    const callable = () => {};
    callable.toString = () => { throw new Error('must not coerce callable'); };
    const crossRealm = require('node:vm').runInNewContext('new Error("cross-realm verification failure")');
    for (const thrown of [Object.create(null), hostile, callable, crossRealm]) {
        const execution = new VerificationWorkspace();
        const failure = await execution.run(() => { throw thrown; }).catch(error => error);
        if (thrown === crossRealm) expect(failure).toBe(crossRealm);
        else {
            expect(failure.message).toBe('Verification failed with a non-Error value.');
            expect(failure.cause).toBe(thrown);
        }
        expect(fs.existsSync(execution.directory)).toBe(false);
    }
});

(process.platform === 'win32' ? test : test.skip).each([true, false])(
    'an actual file lock reports retained workspace and preserves primary failure (%s)', async primaryFails => {
        const execution = new VerificationWorkspace();
        fs.writeFileSync(path.join(execution.directory, 'locked.txt'), 'actual file');
        const locker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            "$stream=[System.IO.File]::Open('locked.txt','Open','Read','None'); Write-Output 'locked'; [Console]::ReadLine() | Out-Null; $stream.Dispose()"],
        { cwd: execution.directory, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        const closed = new Promise(resolve => locker.once('close', resolve));
        const original = new Error('primary check failed');
        try {
            await withTimeout(new Promise((resolve, reject) => {
                locker.once('error', reject); locker.stdout.once('data', resolve);
            }), 'exclusive file lock', 5000);
            const failure = await execution.run(async () => { if (primaryFails) throw original; }).catch(error => error);
            expect(failure.retainedWorkspace).toBe(execution.directory);
            expect(fs.existsSync(execution.directory)).toBe(true);
            if (primaryFails) {
                expect(failure).toBeInstanceOf(AggregateError);
                expect(failure.errors[0]).toBe(original);
                expect(failure.cause).toBe(original);
            } else expect(failure.code).toBeDefined();
        } finally {
            locker.stdin.end('\n');
            await withTimeout(closed, 'file lock release', 5000);
            fs.rmSync(execution.directory, { recursive: true, force: true });
        }
    }, 12000);

test.each(['swallow', 'rethrow', 'replace'])('uncertain process cleanup retains the workspace despite %s of its error', async mode => {
    const execution = new VerificationWorkspace();
    let descendant;
    try {
        const failure = await execution.run(async context => {
            try {
                await context.command(['-e', `const child=require('child_process').spawn(process.execPath,
                    ['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit'],windowsHide:true,detached:${process.platform === 'win32'}});
                    require('fs').writeFileSync('child.pid',String(child.pid)); process.exit(0);`], { timeoutMs: 2000 });
            } catch (error) {
                await expect(context.command(['-e', ''])).rejects.toBe(error);
                // Even swallowing the command error must not permit run() success.
                if (mode === 'rethrow') throw error;
                if (mode === 'replace') throw new Error('replacement failure');
            } finally { descendant = Number(fs.readFileSync(path.join(context.directory, 'child.pid'), 'utf8')); }
        }).catch(error => error);
        expect(failure).toBeInstanceOf(AggregateError);
        expect(failure.cause.message).toContain(mode === 'replace' ? 'replacement failure' : 'package verification command');
        expect(failure.retainedWorkspace).toBe(execution.directory);
        expect(execution.cleanupFailure).toBe(mode === 'replace' ? failure.errors[1] : failure);
    } finally {
        await stopDescendant(descendant);
        await fs.promises.rm(execution.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
}, 12000);

test('a verifier with uncertain descendant cleanup exits with failure without waiting for that descendant', async () => {
    const supervisor = new VerificationWorkspace();
    let report;
    try {
        const source = `const fs=require('fs'); const path=require('path');
            const {VerificationWorkspace}=require(${JSON.stringify(require.resolve('../../scripts/lib/VerificationWorkspace'))});
            const execution=new VerificationWorkspace();
            execution.run(async context=>{
                try { await context.command(['-e', ${JSON.stringify(`const child=require('child_process').spawn(process.execPath,
                    ['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit'],windowsHide:true,detached:${process.platform === 'win32'}});
                    require('fs').writeFileSync('child.pid',String(child.pid)); process.exit(0);`)}],{timeoutMs:500}); }
                catch { throw new Error('outer verification failed'); }
            }).catch(error=>{fs.writeFileSync(${JSON.stringify(path.join(supervisor.directory, 'report.json'))},JSON.stringify({
                directory:error.retainedWorkspace, pid:Number(fs.readFileSync(path.join(execution.directory,'child.pid'),'utf8')),
                message:error.message, cleanupError:error.errors[1].message })); process.exitCode=1; });`;
        const child = spawn(process.execPath, ['-e', source], { cwd: supervisor.directory, windowsHide: true, stdio: 'ignore' });
        const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
        try { expect(await withTimeout(exit, 'verifier exit independent of descendant', 9000)).toBe(1); }
        finally {
            const file = path.join(supervisor.directory, 'report.json');
            if (fs.existsSync(file)) report = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (child.exitCode === null) { child.kill(); await withTimeout(exit, 'outer verifier termination', 5000); }
        }
        expect(report.message).toBe('outer verification failed');
        expect(report.cleanupError).toContain('package verification command');
        expect(() => process.kill(report.pid, 0)).not.toThrow();
    } finally {
        await stopDescendant(report?.pid);
        if (report) await fs.promises.rm(report.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        await fs.promises.rm(supervisor.directory, { recursive: true, force: true });
    }
}, 15000);
