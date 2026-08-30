'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { projectNodeIssue } = require('../../src/cli/ProjectDoctor');

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
    const manifest = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
    if (projectNodeIssue(process.versions.node, manifest.engines?.node)?.severity === 'error') {
        return `# SKIP ${template}: requires Node ${manifest.engines.node}; current ${process.versions.node}. CI verifies it on Node 22.\n`;
    }
    fs.mkdirSync(path.join(target, 'node_modules'));
    for (const [name, directory] of [
        ['redweb', packageRoot],
        ['typescript', path.dirname(require.resolve('typescript/package.json'))],
        ['ws', path.dirname(require.resolve('ws/package.json'))],
        ...(manifest.dependencies.zod ? [['zod', path.dirname(require.resolve('zod/package.json'))]] : []),
        ...(template === 'dashboard' ? [['express', path.dirname(require.resolve('express/package.json'))]] : []),
        ...(template === 'dashboard' ? [['c8', path.dirname(require.resolve('c8/package.json'))]] : []),
        ['.bin', path.resolve(path.dirname(require.resolve('typescript/package.json')), '../.bin')],
    ]) fs.symlinkSync(directory, path.join(target, 'node_modules', name), 'junction');
    if (template === 'dashboard') {
        const types = path.join(target, 'node_modules/@types');
        fs.mkdirSync(types);
        for (const [name, module] of [['node', 'redweb-dashboard-types'], ['express', '@types/express']]) {
            fs.symlinkSync(path.dirname(require.resolve(`${module}/package.json`)), path.join(types, name), 'junction');
        }
    }
    const tests = spawnSync('npm', ['test'], {
        cwd: target, encoding: 'utf8', timeout: 30000, windowsHide: true, shell: process.platform === 'win32',
    });
    if (tests.status !== 0) throw new Error(`Generated npm test failed:\n${tests.error || ''}${tests.stdout}${tests.stderr}`);
    // Deployment must use compiled output/assets, not accidentally depend on the source tree.
    fs.renameSync(path.join(target, 'src'), path.join(target, 'source-not-deployed'));
    return node(['--test', 'test/app.test.cjs', 'test/run-app.test.cjs'], target);
}

module.exports = { verifyStarter, verifyApplication };
