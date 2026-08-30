'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { verifyStarter, verifyApplication } = require('../../scripts/lib/verify-starter');
const { waitForCondition } = require('../helpers/network');

const root = path.resolve(__dirname, '../..');

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

test('real npm descendants are terminated before cleanup after a starter timeout', async () => {
    const execution = new VerificationWorkspace();
    const target = application(execution, `
        const child = require('node:child_process').spawn(process.execPath,
            ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
        require('node:fs').writeFileSync('descendant.pid', String(child.pid));
        console.error('starter timeout evidence');
        setInterval(() => {}, 1000);
    `);
    let descendant;
    try {
        const failure = await execution.run(async context => {
            try { await verifyApplication(root, target, 'realtime', context, { timeoutMs: 2000 }); }
            finally { descendant = Number(fs.readFileSync(path.join(target, 'descendant.pid'), 'utf8')); }
        }).catch(error => error);
        expect(failure.message).toContain('starter timeout evidence');
        expect(() => process.kill(descendant, 0)).toThrow();
        expect(fs.existsSync(execution.directory)).toBe(false);
    } finally {
        if (descendant) {
            try { process.kill(descendant); } catch (error) { if (error.code !== 'ESRCH') throw error; }
            await waitForCondition(() => {
                try { process.kill(descendant, 0); return false; }
                catch (error) { if (error.code !== 'ESRCH') throw error; return true; }
            }, 'owned verifier descendant exit', 5000);
        }
        await fs.promises.rm(execution.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
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
