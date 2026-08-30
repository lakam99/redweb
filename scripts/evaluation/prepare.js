'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function command(executable, args, options) {
    const result = spawnSync(executable, args, { encoding: 'utf8', windowsHide: true, ...options });
    if (result.status !== 0) throw new Error(`${executable} failed: ${result.error || result.stderr || result.stdout}`);
    return result.stdout;
}

/** Snapshot a candidate; never publish or install into either project checkout. */
function prepare(root = path.resolve(__dirname, '../..')) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'framework-adoption-'));
    const artifacts = path.join(workspace, 'artifacts');
    fs.mkdirSync(artifacts);
    const pack = JSON.parse(command('npm', ['pack', '--json', '--pack-destination', artifacts], {
        cwd: root, shell: process.platform === 'win32', timeout: 60000,
    }))[0];
    const archive = path.join(artifacts, pack.filename);
    command('tar', ['-xf', archive, '-C', artifacts], { timeout: 30000 });
    for (const name of ['assigned', 'discovery']) fs.mkdirSync(path.join(workspace, name));
    const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const manifest = {
        createdAt: new Date().toISOString(), workspace,
        sourceCommit: command('git', ['rev-parse', 'HEAD'], { cwd: root }).trim(),
        archive, archiveSha256: hash(archive),
        documentation: path.join(artifacts, 'package/docs/generated.json'),
        catalogueSha256: hash(path.join(artifacts, 'package/docs/generated.json')),
        node: process.version, platform: process.platform, arch: process.arch,
    };
    fs.writeFileSync(path.join(workspace, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    return manifest;
}

if (require.main === module) console.log(JSON.stringify(prepare(), null, 2));
module.exports = { prepare };
