'use strict';

const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { verifyPackedBrowser } = require('../../scripts/lib/verify-packed-browser');

test.each(['counter', 'chat', 'cards', 'components', 'jsx'])('headed Chromium verifies the %s example independently over HTTP and sockets', async example => {
    const report = await new VerificationWorkspace().run(owner => verifyPackedBrowser(path.resolve(__dirname, '../..'), owner, example));
    expect(report).toMatchObject({ [example]: true, headed: true });
    if (example === 'chat') expect(report).toMatchObject({ reconnect: true, disconnect: true });
    expect(report.browser.product).toMatch(/Chrome|Chromium/);
}, 600000); // Covers sequential 12s operation budgets, launch attempts and cleanup.
