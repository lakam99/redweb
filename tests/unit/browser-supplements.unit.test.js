'use strict';

const { verifyLivePageOwnership } = require('../../scripts/lib/verify-live-page-ownership');
const { verifyRuntimeBrowser } = require('../../scripts/lib/verify-runtime-browser');

// Dependency-boundary units only. The maintained coverage command separately
// executes both unchanged helpers against real Redweb and Chromium.
test.each([verifyLivePageOwnership, verifyRuntimeBrowser])('%p preserves a rejected browser operation', async verify => {
    const failure = new Error('unit browser operation failed');
    await expect(verify({ evaluate: async () => { throw failure; } }, {}, value => value)).rejects.toBe(failure);
});

test('ownership verification rejects a false browser assertion before issuing actions', async () => {
    let calls = 0;
    await expect(verifyLivePageOwnership({ evaluate: async () => { calls++; return false; } }, {}, value => value))
        .rejects.toThrow('mount is idempotent');
    expect(calls).toBe(1);
});

test('runtime verification rejects a missing actual session before sending any frame', async () => {
    let calls = 0;
    await expect(verifyRuntimeBrowser({ evaluate: async () => { calls++; } },
        { server: { manager: { active: new Map() } } }, value => value))
        .rejects.toThrow('An actual live session must exist');
    expect(calls).toBe(1);
});
