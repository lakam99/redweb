'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { FrozenCoverage } = require('../helpers/FrozenCoverage');
const { projectNodeIssue } = require('../../src/cli/ProjectDoctor');
const { projectFiles } = require('../../src/cli/templates');
const root = path.resolve(__dirname, '../..');
const manifest = JSON.parse(projectFiles(require('../../package.json').version, 'dashboard').find(file => file.path === 'package.json').content);
const browserTest = projectNodeIssue(process.versions.node, manifest.engines.node)?.severity === 'error' ? test.skip : test;

// The frozen full workload includes the SQLite dashboard; do not fake support
// on older Node versions. Browser/API/process/filesystem methods are not mocked.
browserTest('the frozen Live HTML CLI completes its full real-browser workload and removes its owned profiles', async () => {
    await new VerificationWorkspace().run(async owner => {
        const coverage = new FrozenCoverage(owner.directory, 'scripts/verify-live-html-browser.js');
        try {
            const output = await owner.command([path.join(root, 'scripts/verify-live-html-browser.js')], {
                timeoutMs: 180000, rejectTruncatedOutput: true,
                environment: { ...coverage.environment, TEMP: owner.directory, TMP: owner.directory, TMPDIR: owner.directory },
            });
            fs.writeFileSync(path.join(owner.directory, 'stdout.log'), output);
            expect(output).toContain('Live HTML browser gate passed: validated actions and feedback, CSS, JSX, collections, components, counter, chat, raw-text safety, and documentation composition.');
            expect(fs.readdirSync(owner.directory).filter(name => name.startsWith('redweb-live-browser-') || name.startsWith('redweb-package-check-'))).toEqual([]);
            coverage.collect();
            const retained = path.join(root, 'coverage/frozen-live-browser/full-native.log');
            fs.mkdirSync(path.dirname(retained), { recursive: true });
            fs.copyFileSync(path.join(owner.directory, 'stdout.log'), retained);
        } catch (error) {
            owner.cleanupFailure = error;
            throw error;
        }
    });
}, 210000);
