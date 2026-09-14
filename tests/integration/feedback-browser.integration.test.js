'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { page } = require('../..');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { BrowserPages } = require('../../scripts/lib/BrowserPages');
const { verifyActionFeedback } = require('../../scripts/lib/verify-action-feedback');
const { browserCandidates, launchBrowserWithRetry, stopBrowser, openPage, eventual } = require('../../scripts/verify-live-html-browser');
const { withTimeout, request } = require('../helpers/network');
const bounded = (promise, label) => withTimeout(promise, label, 15000);

test.each(['success', 'cleanup rejection'])('full feedback driver with actual Chromium: %s', async mode => {
    await new VerificationWorkspace().run(async owner => {
        const executable = process.env.REDWEB_BROWSER || browserCandidates.find(fs.existsSync);
        assert.ok(executable, 'Chromium is required for feedback acceptance');
        const pages = new BrowserPages(owner, openPage, bounded);
        const rawPages = [];
        let launched, driver, application, pageUrl, held, failure;
        let driverValidated = false;
        const cleanupFailure = new Error('native feedback cleanup-only failure');
        const record = error => {
            owner.cleanupFailure = error;
            failure = failure ? new AggregateError([failure, error], failure.message, { cause: failure }) : error;
        };
        try {
            launched = await launchBrowserWithRetry(executable, owner.directory);
            const debugPort = new URL(launched.endpoint).port;
            const options = { debugPort, pages: rawPages, eventual,
                openPage: async (port, url) => { pageUrl = url; return pages.open(port, url); },
            };
            if (mode === 'cleanup rejection') {
                class RejectingPage {
                    render() { return '<p>native cleanup fixture</p>'; }
                    disposed() { throw cleanupFailure; }
                }
                page('/native-feedback-cleanup', { shared: true })(RejectingPage);
                options.serverOptions = {};
                options.onServer = server => { application = server; };
                options.afterChecks = (browser, context) => {
                    expect(browser.socket).toBe(rawPages[0].socket);
                    // Exercise the driver's actual waiter cleanup, not a replacement.
                    held = context.control.wait('native cleanup waiter');
                    context.server.manager.register(RejectingPage);
                };
            }
            driver = verifyActionFeedback(options);
            // Observe the original promise; browser teardown below unblocks commands
            // before a separately bounded drain if this whole-driver watchdog fires.
            const outcome = await withTimeout(driver.then(() => ({ passed: true }), error => ({ error })),
                'whole feedback driver', 180000);
            if (mode === 'success') expect(outcome).toEqual({ passed: true });
            else {
                expect(outcome.error).toBeInstanceOf(AggregateError);
                const leaves = error => error instanceof AggregateError ? error.errors.flatMap(leaves) : [error];
                expect(leaves(outcome.error)).toEqual([cleanupFailure]);
                expect(held).toBeInstanceOf(Promise);
                await expect(withTimeout(held, 'feedback waiter cleanup', 1000)).resolves.toBeUndefined();
                expect(application.server.listening).toBe(false);
                expect(application.manager.sharedPages.size).toBe(0);
            }
            expect(rawPages).toHaveLength(1);
            // The success case omits onServer/afterChecks. Verify its actual listener
            // is closed through the recorded URL, before any test rescue is attempted.
            await expect(request({ port: new URL(pageUrl).port })).rejects.toMatchObject({ code: 'ECONNREFUSED' });
            driverValidated = true;
        } catch (error) { failure = error; }
        finally {
            try { await pages.close(); } catch (error) { record(error); }
            try {
                if (!launched) throw new Error('Feedback acceptance launch cleanup remains uncertain');
                await bounded(stopBrowser(launched.browser.child), 'feedback acceptance browser cleanup');
                assert.ok(launched.browser.child.exitCode !== null || launched.browser.child.signalCode !== null);
            } catch (error) {
                record(error);
                for (const release of [() => launched?.browser.child.stderr?.destroy(), () => launched?.browser.child.unref()]) {
                    try { release(); } catch (cleanup) { record(cleanup); }
                }
            }
            try {
                if (driver) {
                    const outcome = await withTimeout(driver.then(() => ({ passed: true }), error => ({ error })),
                        'feedback driver settlement', 30000);
                    // Only suppress the cleanup rejection already validated above.
                    // A late rejection may contain shutdown failures as well as the
                    // original operation failure, so retain it after a watchdog.
                    if (!outcome.passed && !driverValidated) record(outcome.error);
                }
            }
            catch (error) { record(error); }
            // A genuine cleanup-only failure has already stopped the real server.
            // Only rescue a still-listening application after an earlier test failure.
            try { if (application?.server.listening) await bounded(application.shutdown(), 'feedback acceptance server rescue'); }
            catch (error) { record(error); }
        }
        if (failure) throw failure;
    });
}, 360000); // 48s launch + 180s driver watchdog + bounded teardown/drain, with margin.
