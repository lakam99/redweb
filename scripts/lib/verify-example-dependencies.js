'use strict';

const fs = require('fs');
const path = require('path');
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
    const command = (args, environment) => execution.command(args, { cwd: consumer, environment });
    const install = args => command([npmEntrypoint(), 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', ...args]);
    await install([]);
    const verifyClient = expected => candidate ? candidate.verify(consumer, expected) : verifyInstalledClient(consumer, expected);
    const clientEvidence = verifyClient();
    const withoutValidator = await command(['probe.cjs', 'core'], { NODE_ENV: 'production' });
    await install([`zod@${validatorVersion}`]);
    const withValidator = await command(['probe.cjs', 'chat'], { NODE_ENV: 'development' });
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
