'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { filesUnder } = require('./seal');
const { verify } = require('./verify');
const hash = (file, algorithm = 'sha256', encoding = 'hex') => crypto.createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);

function verifyInputs(directory, application) {
    const seal = JSON.parse(fs.readFileSync(path.join(directory, 'seal.json'), 'utf8'));
    const root = path.resolve(__dirname, '../..');
    for (const [file, expected] of Object.entries(seal.checkerSha256)) assert.equal(hash(path.join(root, file)), expected, `Checker changed after sealing: ${file}`);
    for (const [file, expected] of Object.entries(seal.evidenceSha256)) {
        assert.equal(hash(path.join(directory, file)), expected, `Evidence changed after sealing: ${file}`);
        if (file.startsWith('submission-1/')) assert.equal(hash(path.join(application, file.slice('submission-1/'.length))), expected, `Live submission differs from frozen evidence: ${file}`);
    }
    const archive = path.join(directory, 'redweb-candidate.tgz');
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'input-manifest.json'), 'utf8'));
    assert.equal(hash(archive), manifest.archiveSha256, 'Candidate is not the original nominated archive.');
    const lock = JSON.parse(fs.readFileSync(path.join(application, 'package-lock.json'), 'utf8'));
    assert.equal(lock.packages['node_modules/redweb'].integrity, `sha512-${hash(archive, 'sha512', 'base64')}`, 'Lockfile does not identify the nominated archive.');
    const extracted = fs.mkdtempSync(path.join(os.tmpdir(), 'evaluation-package-check-'));
    let fileCount;
    try {
        execFileSync('tar', ['-xf', archive, '-C', extracted], { windowsHide: true, timeout: 30000 });
        const packaged = path.join(extracted, 'package');
        const files = filesUnder(packaged);
        fileCount = files.length;
        for (const file of files) assert.equal(hash(path.join(application, 'node_modules/redweb', file)), hash(path.join(packaged, file)), `Installed candidate file differs: ${file}`);
    } finally { fs.rmSync(extracted, { recursive: true, force: true }); }
    return { sealSha256: hash(path.join(directory, 'seal.json')), candidateSha256: hash(archive), verifiedInstalledFiles: fileCount };
}

async function runTrial(directory, application) {
    const inputs = verifyInputs(directory, application);
    const execution = fs.mkdtempSync(path.join(os.tmpdir(), 'evaluation-run-'));
    let report;
    try {
        fs.cpSync(path.join(directory, 'submission-1'), execution, { recursive: true });
        fs.cpSync(path.join(application, 'node_modules'), path.join(execution, 'node_modules'), { recursive: true });
        assert.deepEqual(verifyInputs(directory, execution), inputs);
        report = await verify(execution);
        report.inputs = inputs;
        if (fs.existsSync(path.join(execution, 'dist/app.js'))) report.compiledAppSha256 = hash(path.join(execution, 'dist/app.js'));
        // Hooks must not silently replace source/configuration or candidate files.
        try { assert.deepEqual(verifyInputs(directory, execution), inputs); }
        catch (error) { report.passed = false; report.evidenceError = error.message; }
    } catch (error) {
        report = { ...report, passed: false, inputs, preparationError: error.message };
    }
    return saveResult(directory, execution, report);
}

function saveResult(directory, execution, report) {
    // Always retain the primary evidence, even if Windows still holds a temporary file.
    if (!report.cleanupError) {
        try { fs.rmSync(execution, { recursive: true, force: true }); }
        catch (error) { report.cleanupError = error.message; report.passed = false; }
    }
    if (report.cleanupError) report.retainedExecutionDirectory = execution;
    fs.writeFileSync(path.join(directory, 'independent-submission-1.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    return report;
}
if (require.main === module) runTrial(path.resolve(process.argv[2]), path.resolve(process.argv[3])).then(report => {
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
}).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { runTrial, verifyInputs, saveResult };
