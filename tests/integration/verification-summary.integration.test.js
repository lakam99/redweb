'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const helper = path.resolve(__dirname, '../../scripts/lib/finishVerificationSummary.js');

// Real child exits and filesystem obstructions; no transport/process/fs API mocks.
function child(mode, helperPath) {
    const fs = require('node:fs');
    const { finishVerificationSummary } = require(helperPath);
    const summary = { status: 'running' };
    if (mode.includes('index')) fs.mkdirSync('latest.json');
    if (mode === 'report-always') fs.mkdirSync('summary.json');
    let attempts = 0;
    const persist = () => {
        attempts++;
        console.log(`persist=${summary.status}`);
        fs.writeFileSync('summary.json', JSON.stringify(summary));
        try { fs.writeFileSync('latest.json', JSON.stringify({ status: summary.status })); }
        catch (error) {
            if (mode === 'index-once' && attempts === 1) fs.rmdirSync('latest.json');
            throw error;
        }
    };
    finishVerificationSummary(summary, persist, mode.startsWith('prior') ? new Error('application failed') : undefined,
        mode === 'measured' ? 'measured' : 'passed');
    console.log('completed');
}

test.each(['passed', 'measured', 'prior', 'index-once', 'index-always', 'prior-index', 'report-always'])
('terminal evidence keeps real process and filesystem outcomes honest: %s', mode => new VerificationWorkspace().run(async owner => {
    const outcome = await owner.command(['-e', `(${child.toString()})(${JSON.stringify(mode)},${JSON.stringify(helper)})`],
        { timeoutMs: 5000, rejectTruncatedOutput: true }).catch(error => error);
    const success = ['passed', 'measured'].includes(mode);
    const text = success ? outcome : outcome.message;
    expect(text.match(/persist=\w+/g)).toEqual(success ? [`persist=${mode}`] : mode === 'prior' ? ['persist=failed'] :
        [mode === 'prior-index' ? 'persist=failed' : 'persist=passed', 'persist=failed']);
    if (success) expect(text).toContain('completed');
    else {
        expect(outcome).toBeInstanceOf(Error);
        expect(text).not.toContain('completed');
        if (mode.startsWith('prior')) expect(text).toContain('application failed');
        if (mode !== 'prior') expect(text).toMatch(/EISDIR|EPERM/);
    }
    if (mode === 'report-always') expect(fs.statSync(path.join(owner.directory, 'summary.json')).isDirectory()).toBe(true);
    else {
        const summary = JSON.parse(fs.readFileSync(path.join(owner.directory, 'summary.json'), 'utf8'));
        expect(summary.status).toBe(success ? mode : 'failed');
        expect(Number.isFinite(Date.parse(summary.finishedAt))).toBe(true);
        if (!success) expect(summary.error).toBeTruthy();
    }
    if (['index-always', 'prior-index'].includes(mode)) expect(fs.statSync(path.join(owner.directory, 'latest.json')).isDirectory()).toBe(true);
    else if (mode !== 'report-always') expect(JSON.parse(fs.readFileSync(path.join(owner.directory, 'latest.json'), 'utf8')).status).toBe(success ? mode : 'failed');
}), 30000);
