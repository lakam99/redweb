'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { verifyStarter, verifyApplication, linkApplication } = require('../../scripts/lib/verify-starter');
const { waitForCondition } = require('../helpers/network');
const { observeProcess } = require('../helpers/process-observation');

const root = path.resolve(__dirname, '../..');

test('generated network cleanup owns its socket even when the real peer stops reading', async () => {
    await new VerificationWorkspace().run(async execution => {
        const target = path.join(execution.directory, 'network-cleanup');
        await execution.command([path.join(root, 'bin/redweb.js'), 'init', target, '--template', 'realtime', '--json'], { timeoutMs: 5000 });
        linkApplication(root, target, 'realtime', JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')));
        await execution.command([require.resolve('typescript/bin/tsc')], { cwd: target, timeoutMs: 10000 });
        fs.copyFileSync(path.join(root, 'tests/fixtures/recipe-network.test.cjs'), path.join(target, 'test/cleanup.test.cjs'));
        const output = await execution.command(['--test', '--test-reporter=tap', 'test/cleanup.test.cjs'], { cwd: target, timeoutMs: 8000 });
        expect(output).toContain('# pass 2');
        expect(output).toContain('# fail 0');
    });
}, 45000); // 23s command budgets + up to 15s managed process cleanup + filesystem cleanup.

function application(execution, script, testSource = "require('node:test')('actual child', () => {});") {
    const target = path.join(execution.directory, 'application with spaces');
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.mkdirSync(path.join(target, 'test'));
    fs.writeFileSync(path.join(target, 'src/marker.txt'), 'source, not a runtime dependency');
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({
        name: 'verification-fixture', version: '1.0.0', private: true,
        dependencies: {}, scripts: { test: 'node check.cjs' },
    }));
    fs.writeFileSync(path.join(target, 'check.cjs'), script);
    for (const name of ['app.test.cjs', 'run-app.test.cjs']) fs.writeFileSync(path.join(target, 'test', name), testSource);
    return target;
}

test('actual npm failure preserves diagnostics and never starts the source-free phase', async () => {
    const execution = new VerificationWorkspace();
    const target = application(execution, "console.error('npm fixture failed'); process.exitCode=7;");
    const failure = await execution.run(async context => {
        try { await verifyApplication(root, target, 'realtime', context); }
        finally {
            expect(fs.existsSync(path.join(target, 'src'))).toBe(true);
            expect(fs.existsSync(path.join(target, 'source-not-deployed'))).toBe(false);
        }
    }).catch(error => error);
    expect(failure.message).toContain('npm fixture failed');
    expect(failure.message).toContain('(7)');
    expect(fs.existsSync(execution.directory)).toBe(false);
}, 15000);

async function verifyTimedOutApplication({ detached = false, corruptObservation = false } = {}) {
    const execution = new VerificationWorkspace();
    const target = application(execution, `
        const child = require('node:child_process').spawn(process.execPath,
            ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true, detached: ${detached} });
        require('node:fs').writeFileSync('descendant.pid', String(child.pid));
        const { observeProcess } = require(${JSON.stringify(require.resolve('../helpers/process-observation'))});
        const descendant = observeProcess(child.pid);
        const fixture = observeProcess(process.pid);
        require('node:fs').writeFileSync('descendant-start.json', JSON.stringify({
            descendant, fixture,
            groupLeader: fixture.groupId ? observeProcess(fixture.groupId) : undefined,
        }));
        if (${corruptObservation}) require('node:fs').writeFileSync('descendant-start.json', 'invalid JSON');
        console.error('starter timeout evidence');
        setInterval(() => {}, 1000);
    `);
    let descendant, started, failure, commandFailure, diagnosticFailure;
    const observationErrors = [];
    const readObservation = (file, parse) => {
        try { return parse(fs.readFileSync(path.join(target, file), 'utf8')); }
        catch (error) { observationErrors.push({ file, error: error.code || error.message }); }
    };
    try {
        failure = await execution.run(async context => {
            try { await verifyApplication(root, target, 'realtime', context, { timeoutMs: 2000 }); }
            catch (error) { commandFailure = error; throw error; }
            finally {
                descendant = readObservation('descendant.pid', Number);
                started = readObservation('descendant-start.json', JSON.parse);
            }
        }).catch(error => error);
        expect(failure.message).toContain('starter timeout evidence');
        expect(failure.message).toContain('Timed out waiting for package verification command');
        expect(observationErrors).toEqual([]);
        expect(Number.isInteger(descendant) && descendant > 0).toBe(true);
        expect(() => process.kill(descendant, 0)).toThrow();
        expect(fs.existsSync(execution.directory)).toBe(false);
    } catch (error) {
        // Sample before the fallback signal. This is a later observation than
        // the assertion, not proof of the process state at the failing instant.
        const observed = {
            commandFailure: commandFailure?.message, commandCause: commandFailure?.cause?.message,
            workspaceFailure: failure?.message, started, observationErrors,
            descendant: descendant ? observeProcess(descendant) : undefined,
            groupLeader: started?.fixture.groupId ? observeProcess(started.fixture.groupId) : undefined,
            workspaceExists: fs.existsSync(execution.directory),
        };
        diagnosticFailure = new Error(`${error.message}\nProcess cleanup observation: ${JSON.stringify(observed)}`, { cause: error });
        throw diagnosticFailure;
    } finally {
        try {
            if (descendant) {
                try { process.kill(descendant); } catch (error) { if (error.code !== 'ESRCH') throw error; }
                await waitForCondition(() => {
                    try { process.kill(descendant, 0); return false; }
                    catch (error) { if (error.code !== 'ESRCH') throw error; return true; }
                }, 'owned verifier descendant exit', 5000);
            }
            await fs.promises.rm(execution.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        } catch (cleanup) {
            throw diagnosticFailure ? new AggregateError([diagnosticFailure, cleanup], diagnosticFailure.message, { cause: diagnosticFailure }) : cleanup;
        }
    }
}

test('real npm descendants are terminated before cleanup after a starter timeout',
    () => verifyTimedOutApplication(), 15000);

(process.platform === 'linux' ? test : test.skip)('cleanup diagnostics identify a real escaped descendant before fallback terminates it', async () => {
    const failure = await verifyTimedOutApplication({ detached: true }).catch(error => error);
    expect(failure.constructor).toBe(Error); // Never accept an aggregate fallback failure.
    expect(failure.cause.message).toContain('Received function did not throw');
    const observed = JSON.parse(failure.message.split('\nProcess cleanup observation: ')[1]);
    expect(observed.commandFailure).toContain('Timed out waiting for package verification command');
    expect(observed.started.descendant.groupId).toBe(observed.descendant.pid);
    expect(observed.descendant.groupId).not.toBe(observed.started.fixture.groupId);
    expect(observed.descendant.startTicks).toBe(observed.started.descendant.startTicks);
    expect(['R', 'S']).toContain(observed.descendant.state);
    // This assertion runs after the unchanged fallback and its exit wait.
    expect(() => process.kill(observed.descendant.pid, 0)).toThrow();
}, 15000);

test('a genuinely malformed observation file cannot replace the original timeout evidence', async () => {
    const failure = await verifyTimedOutApplication({ corruptObservation: true }).catch(error => error);
    expect(failure.constructor).toBe(Error); // The real fallback must have succeeded.
    const observed = JSON.parse(failure.message.split('\nProcess cleanup observation: ')[1]);
    expect(observed.commandFailure).toContain('Timed out waiting for package verification command');
    expect(observed.commandCause).toBe('Timed out waiting for package verification command');
    expect(observed.observationErrors).toEqual([{ file: 'descendant-start.json', error: expect.any(String) }]);
    expect(() => process.kill(observed.descendant.pid, 0)).toThrow();
}, 15000);

test('source-free tests run only after actual npm success and source removal', async () => {
    await new VerificationWorkspace().run(async execution => {
        const target = application(execution,
            "require('node:fs').writeFileSync('npm-completed.txt', 'done');",
            `const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs');
            test('phase ordering', () => {
                assert.equal(fs.readFileSync('npm-completed.txt', 'utf8'), 'done');
                assert.equal(fs.existsSync('src'), false);
                assert.equal(fs.existsSync('source-not-deployed/marker.txt'), true);
            });`);
        const output = await verifyApplication(root, target, 'realtime', execution);
        expect(output).toContain('# pass 2');
        expect(output).toContain('# fail 0');
    });
}, 15000);

test.each([
    ["console.log('not-json');", SyntaxError],
    ["console.log(JSON.stringify({created: []}));", /Incomplete realtime starter/],
])('malformed actual initializer output fails closed: %s', async (program, expected) => {
    const execution = new VerificationWorkspace();
    const packageRoot = path.join(execution.directory, 'invalid package');
    fs.mkdirSync(path.join(packageRoot, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'bin/redweb.js'), program);
    await expect(execution.run(context => verifyStarter(packageRoot, context, 'realtime'))).rejects.toThrow(expected);
    expect(fs.existsSync(execution.directory)).toBe(false);
}, 15000);

test('unsupported actual Node requirements are reported before linking or executing an application', async () => {
    await new VerificationWorkspace().run(async execution => {
        const target = application(execution, "throw Error('must not execute');");
        const manifest = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
        manifest.engines = { node: '>=99' };
        fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(manifest));
        expect(await verifyApplication(root, target, 'dashboard', execution)).toContain('# SKIP dashboard');
        expect(fs.existsSync(path.join(target, 'node_modules'))).toBe(false);
    });
});
