'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function node(args, cwd) {
    const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 30000, windowsHide: true });
    if (result.status !== 0) throw new Error(`${args.join(' ')} failed:\n${result.error || ''}${result.stdout}${result.stderr}`);
    return result.stdout;
}

// Both CI and the tarball gate use the exact generated tests, with real consumers and network listeners.
function verifyStarter(packageRoot, workspace, template) {
    const target = path.join(workspace, template);
    const output = node([path.join(packageRoot, 'bin/redweb.js'), 'init', target, '--template', template, '--json'], workspace);
    const report = JSON.parse(output);
    if (report.created.length < 9) throw new Error(`Incomplete ${template} starter`);
    return verifyApplication(packageRoot, target, template);
}

function verifyApplication(packageRoot, target, template) {
    fs.mkdirSync(path.join(target, 'node_modules'));
    for (const [name, directory] of [
        ['redweb', packageRoot],
        ['typescript', path.dirname(require.resolve('typescript/package.json'))],
        ['ws', path.dirname(require.resolve('ws/package.json'))],
        ...(template === 'socket' ? [['zod', path.dirname(require.resolve('zod/package.json'))]] : []),
        ['.bin', path.resolve(path.dirname(require.resolve('typescript/package.json')), '../.bin')],
    ]) fs.symlinkSync(directory, path.join(target, 'node_modules', name), 'junction');
    const tests = spawnSync('npm', ['test'], {
        cwd: target, encoding: 'utf8', timeout: 30000, windowsHide: true, shell: process.platform === 'win32',
    });
    if (tests.status !== 0) throw new Error(`Generated npm test failed:\n${tests.error || ''}${tests.stdout}${tests.stderr}`);
    // Deployment must use compiled output/assets, not accidentally depend on the source tree.
    fs.renameSync(path.join(target, 'src'), path.join(target, 'source-not-deployed'));
    return node(['--test', 'test/app.test.cjs'], target);
}

module.exports = { verifyStarter, verifyApplication };
