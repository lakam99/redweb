'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { verifyDashboard } = require('../../scripts/lib/verify-dashboard-browser');
const { BrowserPages } = require('../../scripts/lib/BrowserPages');
const { openPage, browserCandidates, launchBrowserWithRetry, stopBrowser, combineFailures } = require('../../scripts/verify-live-html-browser');
const { withTimeout, waitForListening } = require('../helpers/network');
const { projectNodeIssue } = require('../../src/cli/ProjectDoctor');
const { projectFiles } = require('../../src/cli/templates');

const manifest = JSON.parse(projectFiles(require('../../package.json').version, 'dashboard').find(file => file.path === 'package.json').content);
const dashboardTest = projectNodeIssue(process.versions.node, manifest.engines.node)?.severity === 'error' ? test.skip : test;

dashboardTest('dashboard verification uses actual Chromium, authentication, SQLite and private live updates', async () => {
    const executable = process.env.REDWEB_BROWSER || browserCandidates.find(fs.existsSync);
    expect(executable).toBeTruthy();
    const execution = new VerificationWorkspace();
    await execution.run(async owner => {
        const bounded = (promise, label) => withTimeout(promise, label, 15000);
        const pages = new BrowserPages(owner, openPage, bounded);
        let browser, failure;
        const recordCleanup = error => {
            owner.cleanupFailure = combineFailures(owner.cleanupFailure, error);
            failure = combineFailures(failure, error);
        };
        try {
            const launched = await launchBrowserWithRetry(executable, owner.directory);
            browser = launched.browser;
            await verifyDashboard(owner, { debugPort: new URL(launched.endpoint).port,
                openPage: (port, url) => pages.open(port, url) });
            expect(pages.tabs).toHaveLength(2);
            expect(owner.cleanupFailure).toBeNull();
        } catch (error) { failure = error; }
        finally {
            try { await pages.close(); } catch (error) { recordCleanup(error); }
            try {
                if (!browser) throw new Error('Dashboard browser launch cleanup remains uncertain');
                await bounded(stopBrowser(browser.child), 'dashboard test browser shutdown');
                expect(browser.child.exitCode !== null || browser.child.signalCode !== null).toBe(true);
            } catch (error) {
                recordCleanup(error);
                for (const release of [() => browser?.child?.stderr?.destroy(), () => browser?.child?.unref()]) {
                    try { release(); } catch (error) { recordCleanup(error); }
                }
            }
        }
        if (failure) throw failure;
    });
    expect(fs.existsSync(execution.directory)).toBe(false);
}, 300000); // Sequential generated-app commands, browser operations and cleanup.

// A real adverse DevTools HTTP peer exercises the actual openPage request/parser.
// It does not stand in for a successful browser; native-browser acceptance is separate.
async function brokenDevTools() {
    const peer = http.createServer((_request, response) => response.end('invalid DevTools JSON'));
    peer.listen(0, '127.0.0.1');
    await waitForListening(peer);
    return peer;
}

dashboardTest('a dashboard browser setup error closes the real app and permits natural verifier exit', async () => {
    const peer = await brokenDevTools();
    try {
        await new VerificationWorkspace().run(async execution => {
            const output = await execution.command(['-e', `
                const assert = require('node:assert/strict');
                const { verifyDashboardBrowser } = require(${JSON.stringify(require.resolve('../../scripts/lib/verify-dashboard-browser'))});
                const { openPage } = require(${JSON.stringify(require.resolve('../../scripts/verify-live-html-browser'))});
                verifyDashboardBrowser({ openPage, debugPort: ${peer.address().port} }).then(
                    () => { console.error('Expected adverse peer failure'); process.exitCode = 1; },
                    error => { assert(error instanceof SyntaxError); console.log('Expected setup failure preserved'); }
                ).catch(error => { console.error(error); process.exitCode = 1; });
            `], { timeoutMs: 150000 });
            expect(output).toContain('Expected setup failure preserved');
        });
    } finally { await new Promise(resolve => peer.close(resolve)); }
}, 180000); // Outlast the inner sequential command limits and cleanup.

(process.platform === 'win32' ? dashboardTest : test.skip)('actual locked-workspace cleanup preserves the dashboard setup failure', async () => {
    const execution = new VerificationWorkspace();
    const peer = await brokenDevTools();
    fs.writeFileSync(path.join(execution.directory, 'locked.txt'), 'owned lock regression');
    const locker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "$stream=[System.IO.File]::Open('locked.txt','Open','Read','None'); Write-Output 'locked'; [Console]::ReadLine() | Out-Null; $stream.Dispose()"],
    { cwd: execution.directory, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const closed = new Promise(resolve => locker.once('close', resolve));
    try {
        await withTimeout(new Promise((resolve, reject) => {
            locker.once('error', reject); locker.stdout.once('data', resolve);
        }), 'owned dashboard file lock', 5000);
        const failure = await execution.run(context => verifyDashboard(context, { openPage, debugPort: peer.address().port })).catch(error => error);
        expect(failure).toBeInstanceOf(AggregateError);
        expect(failure.errors[0]).toBeInstanceOf(SyntaxError);
        expect(failure.cause).toBe(failure.errors[0]);
        expect(failure.retainedWorkspace).toBe(execution.directory);
        expect(fs.existsSync(execution.directory)).toBe(true);
    } finally {
        locker.stdin.end('\n');
        await withTimeout(closed, 'owned dashboard file lock release', 5000);
        await new Promise(resolve => peer.close(resolve));
        await fs.promises.rm(execution.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
}, 180000);
