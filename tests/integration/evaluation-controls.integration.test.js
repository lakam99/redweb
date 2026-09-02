'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { FrozenCoverage } = require('../helpers/FrozenCoverage');
const { outcomes, assertUnsupportedControlFailure } = require('../helpers/evaluation-controls');
const root = path.resolve(__dirname, '../..');

test('the real control validator accepts four controls and rejects seven faults, or explicitly refuses unsupported interface inspection', async () => {
    await new VerificationWorkspace().run(async owner => {
        const coverage = new FrozenCoverage(owner.directory, ['scripts/evaluation/validate.js', 'scripts/evaluation/verify.js']);
        const reportFile = path.join(owner.directory, 'controls.json');
        try {
            const command = owner.command([path.join(root, 'scripts/evaluation/validate.js'), reportFile], {
                timeoutMs: 240000, rejectTruncatedOutput: true,
                environment: { ...coverage.environment, TEMP: owner.directory, TMP: owner.directory, TMPDIR: owner.directory },
            });
            if (process.platform === 'win32') {
                const output = await command;
                const results = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
                expect(results.map(item => item.fault)).toEqual(Object.keys(outcomes));
                for (const { fault, expectedFailure, result } of results) {
                    expect(expectedFailure).toBe(outcomes[fault]);
                    expect(result.passed).toBe(expectedFailure === null);
                    expect(result.checks.find(check => !check.passed)?.name ?? null).toBe(expectedFailure);
                    expect(result.cleanupError).toBeUndefined();
                    expect(result.causes).toBeUndefined();
                    expect(result.durationMs).toBeGreaterThanOrEqual(0);
                    if (expectedFailure === null) {
                        expect(result.checks).toHaveLength(10);
                        expect(result.notRun).toEqual([]);
                        expect(result.browser.browserVersions).toHaveLength(3);
                    }
                    if (expectedFailure !== 'loopback-binding') expect(result.browser.browserVersions.length).toBeGreaterThan(0);
                    expect(output).toContain(`${fault}: ${expectedFailure ? `correctly rejected at ${expectedFailure}` : 'passed all checks'}`);
                }
                const destination = path.join(root, 'coverage/frozen-controls/native-control-report.json');
                fs.mkdirSync(path.dirname(destination), { recursive: true });
                fs.copyFileSync(reportFile, destination);
            } else {
                assertUnsupportedControlFailure(await command.then(() => null, error => error));
                expect(fs.existsSync(reportFile)).toBe(false);
            }
            expect(fs.readdirSync(owner.directory).filter(name => name.startsWith('framework-acceptance-browser-'))).toEqual([]);
            coverage.collect();
        } catch (error) {
            // The frozen CLI can fail before writing a report. Never erase owned
            // profiles/evidence after uncertainty; this is not a cleanup success.
            owner.cleanupFailure = error;
            throw error;
        }
    });
}, 260000);
