'use strict';

const { BrowserPages } = require('../../scripts/lib/BrowserPages');
const { withTimeout } = require('../helpers/network');

// Promise/ownership units with explicit tab-boundary faults, not browser IT.
const bounded = (promise, label) => withTimeout(promise, label, 20);

test('owns each tab once, closes idempotently and refuses new acquisition after closing', async () => {
    const closed = [], owner = {}, opens = [];
    const pages = new BrowserPages(owner, async (port, url) => {
        opens.push([port, url]); return { socket: { terminate() { closed.push(url); } } };
    }, bounded);
    await pages.open(9222, 'first'); await pages.open(9222, 'second');
    const closing = pages.close();
    expect(pages.close()).toBe(closing);
    await closing;
    await expect(pages.open(9222, 'never')).rejects.toThrow('owner is closing');
    expect(opens).toEqual([[9222, 'first'], [9222, 'second']]);
    expect(closed).toEqual(['first', 'second']);
    expect(owner.cleanupFailure).toBeUndefined();
});

test.each([new Error('opening failed'), null])('a settled failed opening remains an operation failure: %s', async failure => {
    const owner = {};
    const pages = new BrowserPages(owner, () => { throw failure; }, bounded);
    await expect(pages.open(9222, 'rejected')).rejects.toBe(failure);
    await pages.close();
    expect(owner.cleanupFailure).toBeUndefined();
});

test('a tab arriving during cleanup is released and never appended as live', async () => {
    let deliver, closed = 0;
    const owner = {}, timeout = new Error('unit caller timed out');
    const pages = new BrowserPages(owner, () => new Promise(resolve => { deliver = resolve; }),
        (promise, label) => label === 'browser page startup' ? (promise.catch(() => {}), Promise.reject(timeout)) : promise);
    await expect(pages.open(9222, 'late')).rejects.toBe(timeout);
    const closing = pages.close();
    deliver({ socket: { terminate() { closed++; } } });
    await closing;
    expect(closed).toBe(1);
    expect(pages.tabs).toEqual([]);
    expect(owner.cleanupFailure).toBeUndefined();
});

test('unsettled ownership retains failure and observes a still-later failed release', async () => {
    let deliver;
    const owner = {};
    const pages = new BrowserPages(owner, () => new Promise(resolve => { deliver = resolve; }), bounded);
    await expect(pages.open(9222, 'pending')).rejects.toThrow('browser page startup');
    await expect(pages.close()).rejects.toThrow('did not settle');
    const uncertain = owner.cleanupFailure;
    deliver({ socket: { terminate() { throw null; } } });
    await new Promise(resolve => setImmediate(resolve));
    expect(owner.cleanupFailure).toBeInstanceOf(AggregateError);
    expect(owner.cleanupFailure.errors[0]).toBe(uncertain);
    expect(owner.cleanupFailure.errors[1].cause).toBe(null);
    expect(pages.openings[0].settled).toBe(true);
});

test('every tab release is attempted and all failure values are preserved', async () => {
    const owner = {}, released = [], failures = [new Error('first'), undefined];
    let index = 0;
    const pages = new BrowserPages(owner, async () => {
        const id = index++;
        return { socket: { terminate() { released.push(id); throw failures[id]; } } };
    }, bounded);
    await pages.open(9222, 'first'); await pages.open(9222, 'second');
    const failure = await pages.close().catch(error => error);
    expect(failure).toBe(owner.cleanupFailure);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors[0]).toBe(failures[0]);
    expect(failure.errors[1].cause).toBeUndefined();
    expect(released).toEqual([0, 1]);
});
