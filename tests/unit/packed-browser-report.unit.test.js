'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { types } = require('node:util');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { preservePackedBrowserReport } = require('../../scripts/lib/preservePackedBrowserReport');

test.each(['success', 'absent', 'copy-failure', 'write-failure', 'primary-and-copy', 'primary-and-write'])(
    'retains honest evidence with real filesystem conditions: %s', mode => new VerificationWorkspace().run(async execution => {
        const output = path.join(execution.directory, 'output');
        const coverage = path.join(execution.directory, 'coverage');
        fs.mkdirSync(output);
        if (mode !== 'absent') {
            fs.mkdirSync(coverage);
            fs.writeFileSync(path.join(coverage, 'raw.json'), '{"raw":true}');
        }
        if (mode.includes('copy')) fs.writeFileSync(path.join(output, 'coverage'), 'a file prevents directory copying');
        if (mode.includes('write')) fs.mkdirSync(path.join(output, 'report.json'));
        const primary = mode.startsWith('primary') ? new Error('primary browser failure') : undefined;
        const report = { status: 'passed' };
        const failure = preservePackedBrowserReport(report, output, coverage, primary);
        if (mode === 'success' || mode === 'absent') {
            expect(failure).toBeUndefined();
            expect(report.status).toBe('passed');
            expect(fs.existsSync(path.join(output, 'coverage/raw.json'))).toBe(mode === 'success');
        } else {
            expect(types.isNativeError(failure)).toBe(true);
            expect(report.status).toBe('failed');
            expect(report.error).toBe(failure.message);
            if (primary) { expect(failure.cause).toBe(primary); expect(failure.errors[0]).toBe(primary); }
        }
        if (!mode.includes('write')) expect(JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8'))).toEqual(report);
    }));
