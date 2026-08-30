'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function verifyExampleDependencies(archive, workspace, validatorVersion) {
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
    return { withoutValidator, withValidator };
}

module.exports = { verifyExampleDependencies };
