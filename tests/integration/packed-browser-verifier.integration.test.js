'use strict';

const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { verifyPackedBrowser } = require('../../scripts/lib/verify-packed-browser');

test('browser verifier uses actual Chromium, HTTP and sockets for counter/chat lifecycle', async () => {
    const report = await new VerificationWorkspace().run(owner => verifyPackedBrowser(path.resolve(__dirname, '../..'), owner));
    expect(report).toMatchObject({ counter: true, chat: true, reconnect: true, disconnect: true });
    expect(report.browser.product).toMatch(/Chrome|Chromium/);
}, 600000); // Covers sequential 12s operation budgets, launch attempts and cleanup.
