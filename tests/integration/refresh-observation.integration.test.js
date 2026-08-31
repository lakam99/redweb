'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { main } = require('../../scripts/verify-browser-coverage');

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
