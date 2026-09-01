'use strict';

const { isNativeError } = require('node:util/types');
const { verifyRefreshControls } = require('../../scripts/lib/verify-refresh-controls');
const leaves = error => Array.isArray(error?.errors) ? error.errors.flatMap(leaves) : [error];

// Explicit peer-boundary failures; native Chromium/HTTP acceptance is separate.
test.each([undefined, null, false, 0, '', Object.create(null), new Error('original')])
('refresh controls reject every failure value: %p', async primary => {
    const cleanup = [];
    const peer = { listen: async () => { throw primary; },
        releaseScripts() { cleanup.push('scripts'); }, pause: async () => { cleanup.push('peer'); } };
    let rejected = false;
    const result = await verifyRefreshControls(0, 'unused', { peer }).catch(error => { rejected = true; return error; });
    expect(rejected).toBe(true);
    expect(isNativeError(result)).toBe(true);
    if (isNativeError(primary)) expect(result).toBe(primary);
    else expect(result.cause).toBe(primary);
    expect(cleanup).toEqual(['scripts', 'peer']);
});

test('the revision peer preserves a shutdown callback error', async () => {
    const { RevisionPeer } = require('../../scripts/lib/verify-refresh-controls');
    const peer = new RevisionPeer();
    const primary = new Error('close callback');
    peer.server = { listening: true, closeAllConnections() {}, close(callback) { callback(primary); } };
    await expect(peer.pause()).rejects.toBe(primary);
    await expect(peer.pause()).rejects.toBe(primary);
});

test('falsy cleanup failures are normalized without losing the original failure', async () => {
    const primary = new Error('listen failed');
    const result = await verifyRefreshControls(0, 'unused', { peer: {
        listen: async () => { throw primary; }, releaseScripts() { throw null; }, pause: async () => { throw false; },
    } }).catch(error => error);
    const failures = leaves(result);
    expect(failures).toHaveLength(3);
    expect(failures.every(isNativeError)).toBe(true);
    expect(failures[0]).toBe(primary);
    expect(failures.slice(1).map(error => error.cause)).toEqual([null, false]);
});

test('a falsy page-close failure is retained alongside failed browser initialization', async () => {
    const primary = new Error('initialization failed');
    const result = await verifyRefreshControls(0, 'unused', {
        peer: { listen: async () => {}, releaseScripts() {}, pause: async () => {} },
        open: async () => ({ command: async () => { throw primary; } }),
        closePage: async () => { throw undefined; },
    }).catch(error => error);
    const failures = leaves(result);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toBe(primary);
    expect(isNativeError(failures[1])).toBe(true);
    expect(failures[1].cause).toBeUndefined();
});
