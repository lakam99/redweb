'use strict';

const fs = require('fs');
const path = require('path');
const { npmEntrypoint } = require('../evaluation/process');

async function verifyExampleDependencies(archive, workspace, validatorVersion, cliDependencies, execution) {
    const consumer = path.join(workspace, 'production-examples');
    fs.mkdirSync(consumer);
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({
        name: 'redweb-production-example-check', private: true, dependencies: { redweb: `file:${archive.replaceAll('\\', '/')}` },
    }));
    fs.copyFileSync(path.join(__dirname, 'example-dependency-probe.cjs'), path.join(consumer, 'probe.cjs'));
    const command = (args, environment) => execution.command(args, { cwd: consumer, environment });
    const install = args => command([npmEntrypoint(), 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', ...args]);
    await install([]);
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
    return { withoutValidator, withValidator, additions: 'Packed page/component/socket-route additions passed in the clean installed consumer.' };
}

module.exports = { verifyExampleDependencies };
