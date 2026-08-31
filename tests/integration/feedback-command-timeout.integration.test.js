'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { BrowserPages } = require('../../scripts/lib/BrowserPages');
const { verifyActionFeedback } = require('../../scripts/lib/verify-action-feedback');
const { browserCandidates, launchBrowserWithRetry, stopBrowser, openPage, eventual } = require('../../scripts/verify-live-html-browser');
const { withTimeout } = require('../helpers/network');
const bounded = (promise, label) => withTimeout(promise, label, 15000);

test('a genuinely disconnected DevTools socket reaches the command deadline and server cleanup', async () => {
    await new VerificationWorkspace().run(async owner => {
        const executable = process.env.REDWEB_BROWSER || browserCandidates.find(fs.existsSync);
        assert.ok(executable, 'Chromium is required for the native feedback timeout test');
        let launched, application, failure;
        const pages = new BrowserPages(owner, openPage, bounded);
        try {
            launched = await launchBrowserWithRetry(executable, owner.directory);
            const debugPort = new URL(launched.endpoint).port;
            const operation = verifyActionFeedback({ debugPort, pages: [], eventual,
                onServer(server) { application = server; },
                openPage: async (port, url) => {
                    const tab = await pages.open(port, url);
                    const closed = new Promise(resolve => tab.socket.once('close', resolve));
                    // Disconnect a real CDP transport; never replace its methods.
                    tab.socket.terminate();
                    await bounded(closed, 'native DevTools disconnection');
                    expect(tab.socket.readyState).toBe(3);
                    return tab;
                },
            });
            await expect(withTimeout(operation, 'feedback test supervision', 60000))
                .rejects.toThrow('Timed out waiting for browser evaluation');
            // These assertions precede rescue: the verifier must clean up itself.
            expect(application.server.listening).toBe(false);
            expect(application.manager.sharedPages.size).toBe(0);
        } catch (error) { failure = error; }
        finally {
            for (const cleanup of [() => pages.close(),
                () => application && bounded(application.shutdown(), 'feedback test server rescue'),
                async () => {
                    if (!launched) throw new Error('Feedback test launch cleanup remains uncertain');
                    try {
                        await bounded(stopBrowser(launched.browser.child), 'feedback test browser cleanup');
                        assert.ok(launched.browser.child.exitCode !== null || launched.browser.child.signalCode !== null);
                    } catch (error) {
                        const errors = [error];
                        // Releasing local handles is not proof of process exit.
                        for (const release of [() => launched.browser.child.stderr?.destroy(), () => launched.browser.child.unref()]) {
                            try { release(); } catch (cleanup) { errors.push(cleanup); }
                        }
                        throw new AggregateError(errors, 'Feedback test browser cleanup remains uncertain', { cause: error });
                    }
                }]) {
                try { await cleanup(); }
                catch (error) { owner.cleanupFailure = error; failure = failure ? new AggregateError([failure, error]) : error; }
            }
        }
        if (failure) throw failure;
    });
}, 180000); // Bounded launch, 60s supervision, and independent cleanup/rescue.
