'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
const { filesUnder, seal } = require('../../scripts/evaluation/seal');
const { verifyInputs, saveResult } = require('../../scripts/evaluation/run-trial');
const { withTimeout } = require('../helpers/network');
const hash = (file, algorithm = 'sha256', encoding = 'hex') => crypto.createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);

describe('evaluation evidence using real files and archives', () => {
    let root, evidence, application;
    const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'evaluation-evidence-test-'));
        evidence = path.join(root, 'evidence'); application = path.join(root, 'application');
        for (const name of ['assigned-prompt.txt', 'discovery-prompt.txt', 'protocol.md', 'DISCOVERY.md']) write(path.join(evidence, name), name);
        write(path.join(evidence, 'submission-1/src/app.tsx'), 'export const counter = 0;');
        write(path.join(root, 'package/index.js'), 'module.exports = { fixture: true };');
        const archive = path.join(evidence, 'redweb-candidate.tgz');
        execFileSync('tar', ['-czf', archive, '-C', root, 'package'], { windowsHide: true, timeout: 10000 });
        write(path.join(evidence, 'input-manifest.json'), { archiveSha256: hash(archive) });
        write(path.join(evidence, 'submission-1/package-lock.json'), {
            packages: { 'node_modules/redweb': { integrity: `sha512-${hash(archive, 'sha512', 'base64')}` } },
        });
        fs.cpSync(path.join(evidence, 'submission-1'), application, { recursive: true });
        fs.cpSync(path.join(root, 'package'), path.join(application, 'node_modules/redweb'), { recursive: true });
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
    test('enumerates nested evidence deterministically and rejects linked directories', () => {
        expect(filesUnder(path.join(evidence, 'submission-1'))).toEqual(['package-lock.json', 'src/app.tsx']);
        fs.symlinkSync(path.join(root, 'package'), path.join(evidence, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
        expect(() => filesUnder(evidence)).toThrow('symbolic link');
    });
    test('seals protocol, prompts, source, dependency and checker identities without overwriting a seal', () => {
        const record = seal(evidence);
        expect(record.evidenceSha256['protocol.md']).toBe(hash(path.join(evidence, 'protocol.md')));
        expect(record.evidenceSha256['submission-1/package-lock.json']).toBeDefined();
        expect(record.checkerSha256['scripts/evaluation/run-trial.js']).toBeDefined();
        expect(record.checkerSha256['package-lock.json']).toBeDefined();
        expect(() => seal(evidence)).toThrow();
        expect(verifyInputs(evidence, application).verifiedInstalledFiles).toBe(1);
    });
    test('rejects changed frozen evidence and changed live submission independently', () => {
        seal(evidence);
        write(path.join(application, 'src/app.tsx'), 'changed live source');
        expect(() => verifyInputs(evidence, application)).toThrow('Live submission differs');
        fs.copyFileSync(path.join(evidence, 'submission-1/src/app.tsx'), path.join(application, 'src/app.tsx'));
        write(path.join(evidence, 'protocol.md'), 'changed acceptance requirements');
        expect(() => verifyInputs(evidence, application)).toThrow('Evidence changed after sealing');
    });
    test('checks actual installed bytes, not merely the package name or version', () => {
        seal(evidence);
        write(path.join(application, 'node_modules/redweb/index.js'), 'modified installed implementation');
        expect(() => verifyInputs(evidence, application)).toThrow('Installed candidate file differs');
    });
    test('rejects a lockfile that does not identify the nominated archive', () => {
        const lock = { packages: { 'node_modules/redweb': { integrity: 'sha512-wrong' } } };
        write(path.join(evidence, 'submission-1/package-lock.json'), lock);
        write(path.join(application, 'package-lock.json'), lock);
        seal(evidence);
        expect(() => verifyInputs(evidence, application)).toThrow('Lockfile does not identify');
    });
    test('rejects checker revisions different from the sealed revision', () => {
        const record = seal(evidence);
        record.checkerSha256['scripts/evaluation/run-trial.js'] = 'different';
        write(path.join(evidence, 'seal.json'), record);
        expect(() => verifyInputs(evidence, application)).toThrow('Checker changed after sealing');
    });
    (process.platform === 'win32' ? test : test.skip)('persists primary evidence when an actual Windows file lock prevents cleanup', async () => {
        const execution = path.join(root, 'execution');
        write(path.join(execution, 'locked.txt'), 'hold this file');
        const locker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            "$stream = [System.IO.File]::Open('locked.txt', 'Open', 'Read', 'None'); Write-Output 'locked'; [Console]::ReadLine() | Out-Null; $stream.Dispose()"],
        { cwd: execution, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        const closed = new Promise(resolve => locker.once('close', resolve));
        try {
            await withTimeout(new Promise((resolve, reject) => {
                locker.once('error', reject); locker.stdout.once('data', resolve);
            }), 'real exclusive file lock', 5000);
            const report = saveResult(evidence, execution, { passed: false, error: 'original failed check', checks: [{ name: 'counter', passed: false }] });
            expect(report.error).toBe('original failed check');
            expect(report.cleanupError).toBeDefined();
            expect(report.retainedExecutionDirectory).toBe(execution);
            expect(JSON.parse(fs.readFileSync(path.join(evidence, 'independent-submission-1.json'), 'utf8'))).toEqual(report);
        } finally { locker.stdin.end('\n'); await withTimeout(closed, 'file lock release', 5000); }
    }, 12000);
});
