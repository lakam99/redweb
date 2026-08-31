'use strict';

// Explicit report-boundary units; the separate integration invokes the entire
// unchanged browser workload with actual Chromium and HTTP peers.
jest.mock('../../scripts/lib/verify-refresh-controls', () => ({
    RevisionPeer: class { constructor(script) { this.script = script; } },
    verifyRefreshControls: jest.fn(),
}));

const { verifyRefreshControls } = require('../../scripts/lib/verify-refresh-controls');
const { verifyRefreshCoverage } = require('../../scripts/lib/verify-refresh-coverage');

test('history observations retain false and true without changing behavioral parity', async () => {
    const run = {};
    for (const instrumented of [false, true]) {
        verifyRefreshControls.mockResolvedValueOnce({ bfcacheRestored: instrumented });
        await verifyRefreshCoverage({ coverage: { source: 'poll();poll();', instrumented: 'poll();poll();' },
            instrumented, run, onPeer() {} });
    }
    expect(run.historyRestoration).toEqual({ plain: { bfcacheRestored: false }, instrumented: { bfcacheRestored: true } });
    expect(run.plainCases).toEqual(run.instrumentedCases);
});

test('failed controls cannot produce a successful history observation', async () => {
    const failure = new Error('unit control failure');
    verifyRefreshControls.mockRejectedValueOnce(failure);
    const run = {};
    await expect(verifyRefreshCoverage({ coverage: { source: 'poll();poll();' }, instrumented: false, run, onPeer() {} }))
        .rejects.toBe(failure);
    expect(run).toEqual({});
});
