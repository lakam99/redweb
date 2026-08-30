const fs = require('fs');
const os = require('os');
const path = require('path');
const { verifyStarter } = require('../../scripts/lib/verify-starter');

describe('generated starters use real HTTP and sockets', () => {
    test.each(['realtime', 'chat', 'site', 'socket'])('%s compiles and passes its shipped network tests without src/', template => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-starter-'));
        try {
            const output = verifyStarter(path.resolve(__dirname, '../..'), workspace, template);
            expect(output).toMatch(/# pass 1/);
            expect(output).toMatch(/# fail 0/);
        } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
    }, 40000);
});
