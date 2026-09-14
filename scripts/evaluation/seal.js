'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

function filesUnder(root, prefix = '') {
    return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(entry => {
        const relative = path.posix.join(prefix, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Evidence must not follow a symbolic link: ${relative}`);
        return entry.isDirectory() ? filesUnder(root, relative) : [relative];
    }).sort();
}

function seal(directory) {
    const root = path.resolve(__dirname, '../..');
    const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const evidence = ['assigned-prompt.txt', 'discovery-prompt.txt', 'protocol.md', 'input-manifest.json', 'redweb-candidate.tgz', 'DISCOVERY.md',
        ...filesUnder(path.join(directory, 'submission-1')).map(file => `submission-1/${file}`)];
    const checker = ['scripts/evaluation/verify.js', 'scripts/evaluation/process.js', 'scripts/evaluation/validate.js', 'scripts/evaluation/run-trial.js', 'scripts/evaluation/seal.js',
        'scripts/evaluation/fixtures/app.js', 'scripts/evaluation/fixtures/page.html', 'scripts/verify-live-html-browser.js', 'tests/helpers/network.js', 'package-lock.json'];
    const result = {
        sealedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        node: process.version, platform: process.platform, arch: process.arch,
        agentSettings: { context: 'fork_turns=none', model: 'inherited; exact model not captured', reasoningEffort: 'inherited; not captured',
            assigned: '/root/adoption_assigned_01', discovery: '/root/adoption_discovery_01' },
        timingNote: 'Behavioral protocol/prompt preregistered; checker implemented after agent submissions. Submission copied before independent build; hashes sealed before that build.',
        evidenceSha256: Object.fromEntries(evidence.map(file => [file, sha256(path.join(directory, file))])),
        checkerSha256: Object.fromEntries(checker.map(file => [file, sha256(path.join(root, file))])),
    };
    fs.writeFileSync(path.join(directory, 'seal.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    return result;
}
if (require.main === module) console.log(JSON.stringify(seal(path.resolve(process.argv[2])), null, 2));
module.exports = { seal, filesUnder };
