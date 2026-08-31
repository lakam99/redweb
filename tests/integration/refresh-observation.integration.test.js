'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { main } = require('../../scripts/verify-browser-coverage');
const { verifyRefreshControls } = require('../../scripts/lib/verify-refresh-controls');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { BrowserPages } = require('../../scripts/lib/BrowserPages');
const { browserCandidates, launchBrowserWithRetry, openPage, stopBrowser, combineFailures } = require('../../scripts/verify-live-html-browser');
const { withTimeout } = require('../helpers/network');

// No browser, transport, filesystem or timer mocks: the canonical plain and
// instrumented refresh workload must persist its actual observations to disk.
test('native refresh verification persists per-mode history observations', async () => {
    await main('refresh');
    const report = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../coverage/browser-refresh/report.json'), 'utf8'));
    expect(Object.keys(report.historyRestoration).sort()).toEqual(['instrumented', 'plain']);
    for (const mode of ['plain', 'instrumented']) {
        expect(typeof report.historyRestoration[mode].bfcacheRestored).toBe('boolean');
    }
    expect(report.plainCases).toEqual(report.instrumentedCases);
}, 300000);

test('standalone refresh controls use their default HTTP peer without supplemental checks', async () => {
    const executable = process.env.REDWEB_BROWSER || browserCandidates.find(fs.existsSync);
    expect(executable).toBeTruthy();
    await new VerificationWorkspace().run(async owner => {
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
            const observed = await verifyRefreshControls(new URL(launched.endpoint).port, owner.directory, {
                open: (port, url) => pages.open(port, url),
                until: async (check, label) => {
                    const deadline = Date.now() + 10000;
                    while (Date.now() < deadline) {
                        if (await check()) return;
                        await new Promise(resolve => setTimeout(resolve, 50));
                    }
                    throw new Error('Timed out: ' + label);
                },
                click: async (page, expression) => {
                    const point = await page.evaluate(`(() => { const box = (${expression}).getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()`);
                    for (const type of ['mousePressed', 'mouseReleased']) await page.command('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
                },
                closePage: async page => {
                    let closeFailure;
                    try { await bounded(page.command('Page.close'), 'standalone refresh page close'); }
                    catch (error) { closeFailure = error; }
                    try { page.socket.terminate(); }
                    catch (error) { closeFailure = combineFailures(closeFailure, error); }
                    if (closeFailure) throw closeFailure;
                },
            });
            expect(typeof observed.bfcacheRestored).toBe('boolean');
            expect(pages.tabs).toHaveLength(6);
        } catch (error) { failure = error; }
        finally {
            try { await pages.close(); } catch (error) { recordCleanup(error); }
            try {
                if (!browser) throw new Error('Refresh browser launch cleanup remains uncertain');
                await bounded(stopBrowser(browser.child), 'refresh test browser shutdown');
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
}, 300000);
