'use strict';

const { browserCommands } = require('../../scripts/lib/browserCommands');

// Explicit command-boundary units, including fake-clock deadline checks.
// The disconnected-Chromium integration test uses real timers and sockets.
test('preserves receivers, arguments, socket identity and the original tab methods', async () => {
    const calls = [], socket = {};
    const tab = { socket,
        async evaluate(expression) { expect(this).toBe(tab); calls.push(['evaluate', expression]); return 42; },
        async command(method, params) { expect(this).toBe(tab); calls.push([method, params]); return { ok: true }; },
    };
    const original = { ...tab }, browser = browserCommands(tab);
    expect(browser.socket).toBe(socket);
    expect(tab).toEqual(original);
    await expect(browser.evaluate('answer')).resolves.toBe(42);
    await expect(browser.command('Network.enable', { value: 1 })).resolves.toEqual({ ok: true });
    await browser.command('Page.enable');
    expect(calls).toEqual([['evaluate', 'answer'], ['Network.enable', { value: 1 }], ['Page.enable', undefined]]);
});

test.each(['evaluate', 'command'])('preserves a synchronous %s failure', method => {
    const failure = new Error('unit synchronous command failure');
    const browser = browserCommands({ [method]() { throw failure; } });
    expect(() => browser[method]('unit')).toThrow(failure);
});

test.each(['evaluate', 'command'].flatMap(method => [null, new Error('unit rejection')].map(failure => ({ method, failure }))))
('preserves asynchronous $method rejection without converting it to success', async ({ method, failure }) => {
    const browser = browserCommands({ [method]: () => Promise.reject(failure) });
    await expect(browser[method]('unit')).rejects.toBe(failure);
});

test.each(['evaluate', 'command'])('bounds an unsettled %s promise at fifteen seconds', async method => {
    jest.useFakeTimers();
    try {
        const browser = browserCommands({ [method]: () => new Promise(() => {}) });
        let settled = false;
        const pending = browser[method]('unit').catch(error => { settled = true; return error; });
        await jest.advanceTimersByTimeAsync(14999);
        expect(settled).toBe(false);
        await jest.advanceTimersByTimeAsync(1);
        const failure = await pending;
        expect(failure.message).toBe(`Timed out waiting for ${method === 'evaluate' ? 'browser evaluation' : 'unit'}`);
        expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
});
