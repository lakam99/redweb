'use strict';

const { scheduleStartupCleanup, awaitStartupCleanup } = require('../../src/StartupCleanup');

test('preserves native errors from another JavaScript context by identity', async () => {
    const error = require('node:vm').runInNewContext('new TypeError("foreign constructor failure")');
    expect(error instanceof Error).toBe(false);
    let cleaned = false;
    expect(scheduleStartupCleanup(error, () => { cleaned = true; })).toBe(error);
    await awaitStartupCleanup(error);
    expect(cleaned).toBe(true);
    expect(error.message).toBe('foreign constructor failure');
});

test('preserves the original constructor error and awaits every nested rollback', async () => {
    const error = new TypeError('construction failed');
    const events = [];
    expect(awaitStartupCleanup(error)).toBeUndefined();
    expect(scheduleStartupCleanup(error, async () => { events.push('inner'); })).toBe(error);
    scheduleStartupCleanup(error, async () => { events.push('outer'); });
    await awaitStartupCleanup(error);
    expect(events).toEqual(['inner', 'outer']);
});

test('a pending inner rollback does not prevent outer cleanup from starting', async () => {
    const error = new Error('primary');
    let release, outer = false;
    const pending = new Promise(resolve => { release = resolve; });
    scheduleStartupCleanup(error, () => pending);
    scheduleStartupCleanup(error, () => { outer = true; });
    await Promise.resolve();
    expect(outer).toBe(true);
    release();
    await awaitStartupCleanup(error);
});

test('retains both rollback failures instead of skipping outer cleanup', async () => {
    const error = new Error('primary');
    scheduleStartupCleanup(error, () => { throw new Error('inner'); });
    scheduleStartupCleanup(error, () => { throw new Error('outer'); });
    const cleanup = await awaitStartupCleanup(error).catch(error => error);
    expect(cleanup.errors[0].errors[0].message).toBe('inner');
    expect(cleanup.errors[1].message).toBe('outer');
});

test('normalizes non-error constructor failures without losing their cause', async () => {
    const error = scheduleStartupCleanup('private detail', () => {});
    expect(error).toBeInstanceOf(Error);
    expect(error.cause).toBe('private detail');
    await awaitStartupCleanup(error);
});
