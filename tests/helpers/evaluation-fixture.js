'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const hash = (file, algorithm = 'sha256', encoding = 'hex') => crypto.createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);
const write = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};

/** Owned synthetic archive/submission for checker tests, never an agent trial. */
function evaluationFixture(root, sources = { 'src/app.tsx': 'export const counter = 0;' }) {
    const evidence = path.join(root, 'evidence'), application = path.join(root, 'application');
    for (const name of ['assigned-prompt.txt', 'discovery-prompt.txt', 'protocol.md', 'DISCOVERY.md']) {
        write(path.join(evidence, name), name);
    }
    for (const [file, content] of Object.entries(sources)) write(path.join(evidence, 'submission-1', file), content);
    write(path.join(root, 'package/index.js'), 'module.exports = { fixture: true };');
    const archive = path.join(evidence, 'redweb-candidate.tgz');
    execFileSync('tar', ['-czf', archive, '-C', root, 'package'], { windowsHide: true, timeout: 10000 });
    write(path.join(evidence, 'input-manifest.json'), { archiveSha256: hash(archive) });
    write(path.join(evidence, 'submission-1/package-lock.json'), {
        packages: { 'node_modules/redweb': { integrity: `sha512-${hash(archive, 'sha512', 'base64')}` } },
    });
    fs.cpSync(path.join(evidence, 'submission-1'), application, { recursive: true });
    fs.cpSync(path.join(root, 'package'), path.join(application, 'node_modules/redweb'), { recursive: true });
    return { evidence, application, archive };
}

/** Do not erase a trial's retained execution when its CLI reports failure. */
function retainTrialFailure(owner, evidence, error) {
    try {
        const result = path.join(evidence, 'independent-submission-1.json');
        const report = fs.existsSync(result) ? JSON.parse(fs.readFileSync(result, 'utf8')) : null;
        const ownedWorkRemains = fs.readdirSync(owner.directory).some(name =>
            name.startsWith('evaluation-run-') || name.startsWith('framework-acceptance-browser-'));
        if (report?.cleanupError || report?.retainedExecutionDirectory || ownedWorkRemains) owner.cleanupFailure = error;
    } catch (recordError) {
        error = new AggregateError([error, recordError], error.message, { cause: error });
        owner.cleanupFailure = error;
    }
    return error;
}

module.exports = { evaluationFixture, write, hash, retainTrialFailure };
