'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { main } = require('../../scripts/lib/ServerRecoveryCandidate');

// Invoked only by the managed integration supervisor, not ordinary discovery.
// Its 90s child deadline precedes this timeout; the outer owner independently
// reaps registered worker groups and preserves evidence if cleanup is uncertain.
test('owned coordinator completes real worker lifecycle', async () => {
    const directory = process.env.TEST_CANDIDATE_EVIDENCE;
    const report = await main([directory]);
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'report.json'), 'utf8'))).toEqual(report);
    expect(report.deliveryAndCleanupPassed).toBe(true);
}, 120000);
