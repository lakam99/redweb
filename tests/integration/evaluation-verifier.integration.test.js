'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { FrozenCoverage } = require('../helpers/FrozenCoverage');
const { write } = require('../helpers/evaluation-fixture');
const { waitForCondition } = require('../helpers/network');
const root = path.resolve(__dirname, '../..');
const prefix = 'Package verification command failed (1): \n';

test.each(['build-failure', 'startup-exit', 'invalid-url', 'http-rejection'])
('the actual evaluator CLI records %s and releases its application', async mode => {
    await new VerificationWorkspace().run(async owner => {
        const app = [
            "require('fs').writeFileSync('application.pid', String(process.pid));",
            "console.log('startup log'); console.log('null'); console.log('{\"url\":17}'); console.error('actual startup diagnostic');",
            mode === 'startup-exit' ? 'process.exitCode = 3;' : mode === 'invalid-url'
                ? "console.log(JSON.stringify({url:'https://127.0.0.1:12345/'})); setInterval(() => {}, 1000);"
                : "const server = require('http').createServer((_req, res) => {res.writeHead(404, {'content-type':'text/plain'}); res.end('not a room');}); server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`})));",
        ].join('\n');
        write(path.join(owner.directory, 'package.json'), { private: true, scripts: { build: 'node build.cjs' } });
        write(path.join(owner.directory, 'app.cjs'), app);
        write(path.join(owner.directory, 'build.cjs'), mode === 'build-failure' ? "console.error('actual build failure'); process.exitCode = 2;"
            : "const fs=require('fs'); fs.mkdirSync('dist'); fs.copyFileSync('app.cjs','dist/app.js'); console.log('built actual application');");
        const coverage = new FrozenCoverage(owner.directory, 'scripts/evaluation/verify.js');
        const reportFile = mode === 'build-failure' ? undefined : path.join(owner.directory, 'report.json');
        let commandFailure;
        try {
            commandFailure = await owner.command([path.join(root, 'scripts/evaluation/verify.js'), owner.directory,
                ...(reportFile ? [reportFile] : [])], { timeoutMs: 60000, rejectTruncatedOutput: true,
                environment: { ...coverage.environment, TEMP: owner.directory, TMP: owner.directory, TMPDIR: owner.directory } })
                .then(() => null, error => error);
            expect(commandFailure).toBeInstanceOf(Error);
            expect(commandFailure.message.startsWith(prefix)).toBe(true);
            const report = JSON.parse(commandFailure.message.slice(prefix.length));
            expect(report.passed).toBe(false);
            expect(report.cleanupError).toBeUndefined();
            expect(report.causes).toBeUndefined();
            if (reportFile) expect(JSON.parse(fs.readFileSync(reportFile, 'utf8'))).toEqual(report);
            if (mode === 'build-failure') {
                expect(report.error).toBe('Independent production build failed.');
                expect(report.build.exitCode).toBe(2);
                expect(report.build.stderr).toContain('actual build failure');
                expect(fs.existsSync(path.join(owner.directory, 'application.pid'))).toBe(false);
            } else {
                expect(report.build.exitCode).toBe(0);
                expect(report.build.stdout).toContain('built actual application');
                const pid = Number(fs.readFileSync(path.join(owner.directory, 'application.pid'), 'utf8'));
                expect(Number.isInteger(pid) && pid > 0).toBe(true);
                await waitForCondition(() => {
                    try { process.kill(pid, 0); return false; }
                    catch (error) { if (error.code === 'ESRCH') return true; throw error; }
                }, `owned application ${pid} to be gone`, 5000);
            }
            if (mode === 'startup-exit') expect(report.error).toContain('Application exited before readiness (3): actual startup diagnostic');
            if (mode === 'invalid-url') expect(report.error).toBe('Application must report an ephemeral loopback HTTP URL.');
            if (mode === 'http-rejection') {
                expect(report.application.errors).toContain('actual startup diagnostic');
                const failedCheck = report.checks.find(check => !check.passed);
                expect(failedCheck.name).toBe(process.platform === 'win32' ? 'http-and-two-tabs' : 'loopback-binding');
                expect(failedCheck.error).toBe(report.error);
                if (process.platform === 'win32') {
                    expect(report.error).toContain('404 !== 200');
                    expect(report.checks[0].passed).toBe(true);
                    expect(report.browser.browserVersions).toEqual([]);
                } else expect(report.error).toBe('Independent listener-interface inspection currently requires Windows; do not claim loopback verification on this platform.');
            } else expect(report.notRun).toHaveLength(10);
            expect(fs.readdirSync(owner.directory).some(name => name.startsWith('framework-acceptance-browser-'))).toBe(false);
            const retained = path.join(root, 'coverage/frozen-evaluator-native', mode + '.json');
            write(retained, report);
            coverage.collect();
        } catch (error) {
            const failure = commandFailure && commandFailure !== error
                ? new AggregateError([commandFailure, error], error.message, { cause: commandFailure }) : error;
            owner.cleanupFailure = failure;
            throw failure;
        }
    });
}, 75000);
