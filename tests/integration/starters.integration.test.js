const path = require('path');
const { verifyStarter } = require('../../scripts/lib/verify-starter');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { TEMPLATES } = require('../../src/cli/templates');

describe('generated starters use real HTTP and sockets', () => {
    test.each(TEMPLATES)('%s compiles and passes its shipped network tests without src/', async template => {
        await new VerificationWorkspace().run(async execution => {
            const output = await verifyStarter(path.resolve(__dirname, '../..'), execution, template);
            if (output.startsWith('# SKIP')) expect(template).toBe('dashboard');
            else {
                expect(output).toMatch(/# pass [1-9]/);
                expect(output).toMatch(/# fail 0/);
            }
        });
    }, 120000); // Three sequential 30s command limits plus bounded process cleanup.
});
