'use strict';

const { scheduleStartupCleanup, awaitStartupCleanup } = require('../../src/StartupCleanup');

test('preserves the original constructor error and awaits nested rollback in order', async () => {
    const error = new TypeError('construction failed');
    const events = [];
    expect(awaitStartupCleanup(error)).toBeUndefined();
    expect(scheduleStartupCleanup(error, async () => { events.push('inner'); })).toBe(error);
    scheduleStartupCleanup(error, async () => { events.push('outer'); });
    await awaitStartupCleanup(error);
    expect(events).toEqual(['inner', 'outer']);
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
