'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { npmEntrypoint } = require('../evaluation/process');
const { verifyInstalledClient } = require('./InstalledClient');

async function verifyExampleDependencies(archive, workspace, validatorVersion, cliDependencies, execution, candidate) {
    const consumer = path.join(workspace, 'production-examples');
    fs.mkdirSync(consumer);
    const manifest = { name: 'redweb-production-example-check', private: true,
        dependencies: { redweb: `file:${archive.replaceAll('\\', '/')}` } };
    if (candidate) {
        const selected = candidate.manifest();
        Object.assign(manifest.dependencies, selected.dependencies);
        manifest.overrides = selected.overrides;
    }
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify(manifest));
    fs.copyFileSync(path.join(__dirname, 'example-dependency-probe.cjs'), path.join(consumer, 'probe.cjs'));
    const support = path.join(consumer, 'probe-support');
    for (const [source, target] of [['../realtime-harness.js', 'realtime-harness.js'],
        ['verificationError.js', 'lib/verificationError.js'], ['performProbeAction.js', 'lib/performProbeAction.js'],
        ['../../tests/helpers/network.js', 'network.js']]) {
        const destination = path.join(support, target);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(__dirname, source), destination, fs.constants.COPYFILE_EXCL);
    }
    fs.mkdirSync(path.join(support, 'node_modules'));
    let linked = false;
    const linkTransport = () => {
        const packagePath = createRequire(path.join(consumer, 'package.json')).resolve('redweb/package.json');
        const transport = fs.realpathSync(path.dirname(createRequire(packagePath).resolve('ws/package.json')));
        const relative = path.relative(fs.realpathSync(path.join(consumer, 'node_modules')), transport);
        assert(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'Probe transport escaped its installed consumer.');
        const link = path.join(support, 'node_modules/ws');
        if (linked) {
            assert(fs.lstatSync(link).isSymbolicLink(), 'Probe transport link changed.');
            fs.unlinkSync(link);
        }
        fs.symlinkSync(transport, link, 'junction'); linked = true;
    };
    const command = (args, environment, timeoutMs = 120000) => execution.command(args, { cwd: consumer, environment, timeoutMs, rejectTruncatedOutput: true });
    const install = args => command([npmEntrypoint(), 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', ...args]);
    await install([]);
    const verifyClient = expected => candidate ? candidate.verify(consumer, expected) : verifyInstalledClient(consumer, expected);
    const clientEvidence = verifyClient();
    linkTransport();
    const withoutValidator = await command(['probe.cjs', 'core'], { NODE_ENV: 'production' }, 90000);
    await install([`zod@${validatorVersion}`]);
    linkTransport();
    const withValidator = await command(['probe.cjs', 'chat'], { NODE_ENV: 'development' }, 90000);
    await command([npmEntrypoint(), 'install', '--include=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--save-dev',
        `typescript@${cliDependencies.typescript}`, `ws@${cliDependencies.ws}`]);
    const cli = path.join(consumer, 'node_modules/redweb/bin/redweb.js');
    await command([cli, 'init', '--existing']);
    const tests = [];
    for (const kind of ['page', 'component', 'socket-route']) {
        const result = JSON.parse(await command([cli, 'add', kind, 'packed', '--json']));
        if (result.registration.status !== 'pending' || result.created.length !== 2) throw new Error('Packed addition report is incorrect.');
        tests.push(result.test);
    }
    await command(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']);
    await command(['--test', ...tests]);
    verifyClient(clientEvidence);
    return { withoutValidator, withValidator, clientEvidence, verifyClient, consumer,
        additions: 'Packed page/component/socket-route additions passed in the clean installed consumer.' };
}

module.exports = { verifyExampleDependencies };
