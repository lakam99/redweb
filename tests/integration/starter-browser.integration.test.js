'use strict';

const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { verifyStarter } = require('../../scripts/lib/verify-starter');
const { verifyStarterBrowser } = require('../../scripts/lib/verify-starter-browser');

test.each(['realtime', 'chat', 'site'])('the generated %s starter runs independently from source-removed output in headed Chromium', async template => {
    const report = await new VerificationWorkspace().run(async execution => {
        await verifyStarter(path.resolve(__dirname, '../..'), execution, template);
        return verifyStarterBrowser(execution, template);
    });
    expect(report).toEqual({ [template]: true, headed: true });
}, 300000);
