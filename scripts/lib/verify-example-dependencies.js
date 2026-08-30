'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function verifyExampleDependencies(archive, workspace, validatorVersion, cliDependencies) {
    const consumer = path.join(workspace, 'production-examples');
    fs.mkdirSync(consumer);
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({
        name: 'redweb-production-example-check', private: true, dependencies: { redweb: `file:${archive.replaceAll('\\', '/')}` },
    }));
    fs.copyFileSync(path.join(__dirname, 'example-dependency-probe.cjs'), path.join(consumer, 'probe.cjs'));
    const command = (executable, args, shell = false) => {
        const result = spawnSync(executable, args, { cwd: consumer, env: { ...process.env, NODE_PATH: '' },
            encoding: 'utf8', windowsHide: true, shell, timeout: 120000 });
        if (result.status !== 0) throw new Error(`Production example dependency check failed: ${result.error || ''}\n${result.stdout}${result.stderr}`);
        return result.stdout;
    };
    const install = args => command('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', ...args], process.platform === 'win32');
    install([]);
    const withoutValidator = command(process.execPath, ['probe.cjs', 'core']);
    install([`zod@${validatorVersion}`]);
    const withValidator = command(process.execPath, ['probe.cjs', 'chat']);
    command('npm', ['install', '--include=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--save-dev',
        `typescript@${cliDependencies.typescript}`, `ws@${cliDependencies.ws}`], process.platform === 'win32');
    const cli = path.join(consumer, 'node_modules/redweb/bin/redweb.js');
    command(process.execPath, [cli, 'init', '--existing']);
    const tests = [];
    for (const kind of ['page', 'component', 'socket-route']) {
        const result = JSON.parse(command(process.execPath, [cli, 'add', kind, 'packed', '--json']));
        if (result.registration.status !== 'pending' || result.created.length !== 2) throw new Error('Packed addition report is incorrect.');
        tests.push(result.test);
    }
    command(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']);
    command(process.execPath, ['--test', ...tests]);
    return { withoutValidator, withValidator, additions: 'Packed page/component/socket-route additions passed in the clean installed consumer.' };
}

module.exports = { verifyExampleDependencies };
