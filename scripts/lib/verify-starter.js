'use strict';

const fs = require('fs');
const path = require('path');
const { npmEntrypoint } = require('../evaluation/process');
const { projectNodeIssue } = require('../../src/cli/ProjectDoctor');
const STARTER_COMMAND_TIMEOUT_MS = 60000;

// Both CI and the tarball gate use the exact generated tests, with real consumers and network listeners.
async function verifyStarter(packageRoot, execution, template, { timeoutMs = STARTER_COMMAND_TIMEOUT_MS } = {}) {
    const target = path.join(execution.directory, template);
    const output = await execution.command([path.join(packageRoot, 'bin/redweb.js'), 'init', target, '--template', template, '--json'],
        { timeoutMs });
    const report = JSON.parse(output);
    if (report.created.length < 9) throw new Error(`Incomplete ${template} starter`);
    return verifyApplication(packageRoot, target, template, execution, { timeoutMs });
}

async function verifyApplication(packageRoot, target, template, execution, { timeoutMs = STARTER_COMMAND_TIMEOUT_MS } = {}) {
    const manifest = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
    if (projectNodeIssue(process.versions.node, manifest.engines?.node)?.severity === 'error') {
        return `# SKIP ${template}: requires Node ${manifest.engines.node}; current ${process.versions.node}. CI verifies it on Node 22.\n`;
    }
    linkApplication(packageRoot, target, template, manifest);
    await execution.command([npmEntrypoint(), 'test'], { cwd: target, timeoutMs });
    // Deployment must use compiled output/assets, not accidentally depend on the source tree.
    fs.renameSync(path.join(target, 'src'), path.join(target, 'source-not-deployed'));
    // Consumers inspect TAP summaries; Node's default reporter varies by version.
    return execution.command(['--test', '--test-reporter=tap', 'test/app.test.cjs', 'test/lifecycle.test.cjs'], { cwd: target, timeoutMs });
}

function linkApplication(packageRoot, target, template, manifest) {
    fs.mkdirSync(path.join(target, 'node_modules'));
    for (const [name, directory] of [
        ['redweb', packageRoot],
        ['typescript', path.dirname(require.resolve('typescript/package.json'))],
        ['ws', path.dirname(require.resolve('ws/package.json'))],
        ...(manifest.dependencies.zod ? [['zod', path.dirname(require.resolve('zod/package.json'))]] : []),
        ...(template === 'dashboard' ? [['express', path.dirname(require.resolve('express/package.json'))]] : []),
        ['c8', path.dirname(require.resolve('c8/package.json'))],
        ['.bin', path.resolve(path.dirname(require.resolve('typescript/package.json')), '../.bin')],
    ]) fs.symlinkSync(directory, path.join(target, 'node_modules', name), 'junction');
    if (template === 'dashboard') {
        const types = path.join(target, 'node_modules/@types');
        fs.mkdirSync(types);
        for (const [name, module] of [['node', 'redweb-dashboard-types'], ['express', '@types/express']]) {
            fs.symlinkSync(path.dirname(require.resolve(`${module}/package.json`)), path.join(types, name), 'junction');
        }
    }
}

module.exports = { verifyStarter, verifyApplication, linkApplication };
