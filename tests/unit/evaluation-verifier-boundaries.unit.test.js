'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EvaluationVerifierBoundary } = require('../helpers/EvaluationVerifierBoundary');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { withTimeout } = require('../helpers/network');

async function boundary(options, assertion) {
    await new VerificationWorkspace().run(async owner => {
        const fixture = new EvaluationVerifierBoundary(owner.directory, options);
        try { await assertion(fixture, owner.directory); }
        finally { fixture.collect(); }
        // All workers here are explicit unit doubles; only owned files need cleanup.
    });
}

test.each(['working', 'delayed-handshake', 'pending-data', 'network-cap'])('evaluator boundary handles %s without changing its check sequence', async mode => {
    await boundary({ mode }, async fixture => {
        const report = await fixture.api.verify(fixture.directory);
        expect(report.passed).toBe(true);
        expect(report.checks).toHaveLength(10);
        expect(report.checks.every(check => check.passed)).toBe(true);
        expect(report.notRun).toEqual([]);
        expect(report.error).toBeUndefined();
        expect(report.cleanupError).toBeUndefined();
        expect(report.browser.browserVersions).toHaveLength(3);
        expect(fixture.stopped).toEqual(fixture.browsers);
        expect(fixture.pages.every(page => page.closed > 0)).toBe(true);
        expect(fixture.removed).toHaveLength(1);
        expect(fs.existsSync(fixture.removed[0])).toBe(false);
        if (mode === 'network-cap') expect(report.browser.networkEventCounts['Network.webSocketFrameReceived']).toBe(30030);
        for (const page of fixture.pages.slice(0, 2)) {
            expect(page.commands).toContainEqual({ method: 'Fetch.continueRequest', params: { requestId: 'before-ready' } });
            expect(page.commands).toContainEqual({ method: 'Fetch.failRequest', params: { requestId: 'after-ready', errorReason: 'BlockedByClient' } });
        }
    });
});

test.each([
    ['no-handshake', 'http-and-two-tabs', 'Room did not establish a real WebSocket connection.'],
    ['persistent-data', 'http-and-two-tabs', 'Persistent HTTP data stream prevents independent WebSocket-only verification.'],
    ['stale-presence', 'disconnect-presence', 'Disconnected Bob remained in presence longer than five seconds.'],
    ['interception-error', 'actual-websocket-traffic', 'HTTP data-transport interception failed.'],
    ['empty-listeners', 'loopback-binding', 'Application listens on a non-loopback interface.'],
    ['wildcard', 'loopback-binding', 'Application listens on a non-loopback interface.'],
])('evaluator boundary rejects %s at the original check', async (mode, failedCheck, message) => {
    await boundary({ mode }, async fixture => {
        const report = await fixture.api.verify(fixture.directory, { skipBuild: true });
        expect(report.passed).toBe(false);
        expect(report.checks.find(check => !check.passed).name).toBe(failedCheck);
        expect(report.error).toContain(message);
        expect(report.cleanupError).toBeUndefined();
        expect(fixture.builds).toEqual([]);
        expect(fixture.stopped).toEqual(fixture.browsers);
    });
});

test.each(['build-error', 'build-nonzero', 'startup-error', 'startup-exit', 'invalid-url', 'no-browser'])('evaluator records %s and always attempts application cleanup', async mode => {
    await boundary({ mode }, async fixture => {
        const report = await fixture.api.verify(fixture.directory);
        expect(report.passed).toBe(false);
        expect(report.error).toBeTruthy();
        expect(report.cleanupError).toBeUndefined();
        expect(fixture.appStops.length).toBeGreaterThan(0);
        if (mode.startsWith('build')) {
            expect(report.error).toBe('Independent production build failed.');
            expect(report.application).toBeUndefined();
            expect(report.notRun).toHaveLength(10);
        }
        if (mode === 'startup-exit') expect(report.error).toContain('Application exited before readiness (3): unit startup diagnostic');
        if (mode === 'startup-error') expect(report.error).toBe(fixture.primary.message);
        if (mode === 'invalid-url') expect(report.error).toBe('Application must report an ephemeral loopback HTTP URL.');
        if (mode === 'no-browser') expect(report.error).toBe('A real Chromium browser is required for independent acceptance.');
    });
});

test.each(['browser-cleanup', 'profile-cleanup', 'combined-cleanup', 'app-cleanup'])('evaluator retains %s in failed report status', async mode => {
    await boundary({ mode }, async fixture => {
        const report = await fixture.api.verify(fixture.directory);
        expect(report.passed).toBe(false);
        expect(fixture.stopped).toEqual(fixture.browsers);
        if (mode === 'app-cleanup') {
            expect(report.cleanupError).toBe(fixture.primary.message);
            expect(report.error).toBeUndefined();
            expect(report.checks).toHaveLength(10);
            expect(report.checks.every(check => check.passed)).toBe(true);
            expect(report.notRun).toEqual([]);
        }
        if (mode === 'browser-cleanup') {
            expect(report.error).toBe(fixture.browserFailure.message);
            expect(report.causes).toEqual([fixture.browserFailure.message, fixture.browserFailure.message]);
            expect(fixture.stopped).toHaveLength(3);
            expect(fixture.removed).toHaveLength(1);
            expect(fs.existsSync(fixture.removed[0])).toBe(false);
        }
        if (mode === 'profile-cleanup') expect(report.error).toBe(fixture.profileFailure.message);
        if (mode === 'combined-cleanup') expect(report.causes).toEqual([fixture.primary.message, fixture.profileFailure.message]);
        if (mode.includes('profile') || mode === 'combined-cleanup') expect(fs.existsSync(fixture.removed[0])).toBe(true);
    });
});

test('direct room inspection supplies its default report without claiming an application binding check', async () => {
    await boundary({}, async fixture => {
        const checks = [];
        const report = await fixture.api.inspectRoom('http://127.0.0.1:12345', checks);
        expect(checks).toHaveLength(9);
        expect(checks.some(check => check.name === 'loopback-binding')).toBe(false);
        expect(report.browserVersions).toHaveLength(3);
        expect(fixture.appStops).toEqual([]);
    });
});

test.each([false, true])('evaluator CLI success boundary preserves optional report=%s', async save => {
    await new VerificationWorkspace().run(async owner => {
        const reportFile = save ? path.join(owner.directory, 'report.json') : undefined;
        const fixture = new EvaluationVerifierBoundary(owner.directory, { cli: true, reportFile });
        try {
            await withTimeout(fixture.completed, 'unit evaluator CLI completion', 5000);
            const report = JSON.parse(fixture.output);
            expect(report.passed).toBe(true);
            expect(fixture.context.process.exitCode).toBeUndefined();
            if (save) expect(JSON.parse(fs.readFileSync(reportFile, 'utf8'))).toEqual(report);
            else expect(fs.readdirSync(owner.directory)).toEqual([]);
        } finally { fixture.collect(); }
    });
});
