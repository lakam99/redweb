'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const { Documentation } = require('../../src/docs/Documentation');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { npmEntrypoint } = require('../../scripts/evaluation/process');
const { verifyInstalledClient } = require('../../scripts/lib/InstalledClient');

const root = path.resolve(__dirname, '../..');
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const filesIn = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    assert.equal(entry.isSymbolicLink(), false, `Build inputs must be regular files/directories: ${file}`);
    return entry.isDirectory() ? filesIn(file) : [file];
});

async function runPrintedSetup(execution, archive, environment, t, afterInstall) {
    const blocks = [...new Documentation(root).setup('realtime').matchAll(/```sh\n([\s\S]*?)\n```/g)];
    assert.equal(blocks.length, 1);
    let cwd = execution.directory;
    for (const line of blocks[0][1].split('\n')) {
        // The interactive watcher is checked by the separate lifecycle gate.
        if (line === 'npm run dev') continue;
        const [program, ...args] = line.split(' ').map(arg => arg === 'TARBALL' ? archive : arg);
        if (program === 'cd') { cwd = path.join(cwd, args[0]); continue; }
        assert.ok(program === 'npm' || program === 'npx');
        const executable = program === 'npm' ? npmEntrypoint() : path.join(path.dirname(npmEntrypoint()), 'npx-cli.js');
        const childEnvironment = line === 'npm test'
            ? { ...environment, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --test-reporter=tap` }
            : environment;
        if (line === 'npm install --save-exact TARBALL') {
            const readme = fs.readFileSync(path.join(cwd, 'README.md'), 'utf8');
            assert.ok(readme.includes(line), 'Execute the same unpublished installation command printed in the generated README.');
        }
        const output = await execution.command([executable, ...args], { cwd, environment: childEnvironment });
        if (program === 'npx') assert.match(output, /Unreleased builds: install the matching Redweb tarball first \(see README.md\)/);
        if (line === 'npm install --save-exact TARBALL' && afterInstall) await afterInstall(cwd);
        if (line === 'npm test') {
            assert.match(output, /# pass [1-9]/);
            assert.match(output, /# fail 0/);
            t.diagnostic(output);
        }
    }
    return cwd;
}

test('printed prerelease setup installs the published client without a checkout or override', async t => {
    await new VerificationWorkspace().run(async execution => {
        const pack = JSON.parse(await execution.command([npmEntrypoint(), 'pack', '--json', '--pack-destination', execution.directory], { cwd: root }));
        const archive = path.join(execution.directory, pack[0].filename);
        const app = await runPrintedSetup(execution, archive, { NODE_TEST_CONTEXT: undefined }, t);
        const manifest = JSON.parse(fs.readFileSync(path.join(app, 'package.json')));
        assert.equal(manifest.overrides, undefined);
        assert.equal(manifest.dependencies['redweb-client'], undefined);
        const installedRedweb = JSON.parse(fs.readFileSync(path.join(app, 'node_modules/redweb/package.json')));
        assert.equal(installedRedweb.version, require('../../package.json').version);
        const installed = verifyInstalledClient(app);
        const locked = require('../../package-lock.json').packages['node_modules/redweb-client'];
        assert.deepEqual([installed.clientVersion, installed.resolved, installed.integrity],
            [locked.version, locked.resolved, locked.integrity]);
        assert.equal(fs.lstatSync(path.join(app, 'node_modules/redweb-client')).isSymbolicLink(), false);
    });
});

test('optional contributor workflow builds and links a client without changing developer inputs', async t => {
    assert.ok(process.env.REDWEB_CLIENT_CHECKOUT, 'Set REDWEB_CLIENT_CHECKOUT to the matching client checkout.');
    const source = fs.realpathSync(process.env.REDWEB_CLIENT_CHECKOUT);
    const inputs = ['package.json', 'package-lock.json', 'tsconfig.json', 'vitest.config.ts', 'src', 'tests'];
    const sourceFiles = inputs.flatMap(name => fs.statSync(path.join(source, name)).isDirectory()
        ? filesIn(path.join(source, name))
        : [path.join(source, name)]);
    const before = new Map(sourceFiles.map(file => [file, digest(file)]));
    const linkedEntry = fs.realpathSync(require.resolve('redweb-client/live-html'));
    const bundles = Object.fromEntries(['index.js', 'index.cjs', 'live-html.js', 'live-html.cjs']
        .map(name => [name, digest(path.join(source, 'dist', name))]));
    const owner = new VerificationWorkspace();
    const failures = [];
    try {
        await owner.run(async execution => {
            const prefix = path.join(execution.directory, 'npm-prefix');
            // Child acceptance is a separate test process, not a worker of this runner.
            const environment = { npm_config_prefix: prefix, NPM_CONFIG_PREFIX: prefix, NODE_TEST_CONTEXT: undefined };
            const npm = (args, cwd) => execution.command([npmEntrypoint(), ...args], { cwd, environment });
            const pack = JSON.parse(await npm(['pack', '--json', '--pack-destination', execution.directory], root));
            const archive = path.join(execution.directory, pack[0].filename);
            t.diagnostic(`Redweb archive sha256: ${digest(archive)}`);
            await execution.command(['-xf', archive, '-C', execution.directory], { executable: 'tar' });
            // The client's lockfile intentionally references the sibling Redweb checkout.
            fs.renameSync(path.join(execution.directory, 'package'), path.join(execution.directory, 'redweb'));
            const client = path.join(execution.directory, 'redweb-client');
            fs.mkdirSync(client);
            for (const name of inputs) fs.cpSync(path.join(source, name), path.join(client, name), { recursive: true });
            const instructions = fs.readFileSync(path.join(root, 'docs/CLIENT_DEVELOPMENT.md'), 'utf8').replace(/\r\n/g, '\n');
            const steps = /```sh\n([\s\S]*?)\n```/.exec(instructions)[1].split('\n');
            assert.equal(steps[0], 'cd ../redweb-client');
            const clientSteps = steps.slice(1, steps.indexOf('cd ../redweb'));
            assert.equal(clientSteps.length, 3);
            const link = steps.find(line => line === 'npm link redweb-client --no-save --ignore-scripts');
            assert.ok(link);
            for (const line of clientSteps) {
                assert.ok(line.startsWith('npm '));
                t.diagnostic(`Client checkout: ${line}`);
                await npm(line.split(' ').slice(1), client);
            }
            const globalRoot = (await npm(['root', '--global'], client)).trim();
            assert.ok(path.relative(prefix, globalRoot) && !path.relative(prefix, globalRoot).startsWith('..'));
            assert.equal(fs.realpathSync(path.join(globalRoot, 'redweb-client')), fs.realpathSync(client));
            for (const [name, hash] of Object.entries(bundles)) assert.equal(digest(path.join(client, 'dist', name)), hash);

            const cwd = await runPrintedSetup(execution, archive, environment, t,
                app => npm(link.split(' ').slice(1), app));
            const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
            assert.equal(manifest.overrides, undefined);
            assert.equal(manifest.dependencies['redweb-client'], undefined);
            const fromApp = createRequire(path.join(cwd, 'package.json'));
            const fromServer = createRequire(fromApp.resolve('redweb/package.json'));
            for (const [specifier, name] of [['redweb-client', 'index.cjs'], ['redweb-client/live-html', 'live-html.cjs']]) {
                assert.equal(fs.realpathSync(fromServer.resolve(specifier)), fs.realpathSync(path.join(client, 'dist', name)));
            }
            t.diagnostic('No client override or saved client dependency; installed Redweb resolves the freshly built npm link.');
        });
    } catch (error) { failures.push(error); }
    for (const [file, hash] of before) {
        try { assert.equal(digest(file), hash, `Developer input changed: ${file}`); }
        catch (error) { failures.push(error); }
    }
    try { assert.equal(fs.realpathSync(require.resolve('redweb-client/live-html')), linkedEntry); }
    catch (error) { failures.push(error); }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
        const error = new AggregateError(failures, failures[0].message, { cause: failures[0] });
        error.retainedWorkspace = failures[0].retainedWorkspace;
        throw error;
    }
    assert.equal(fs.existsSync(owner.directory), false);
});
