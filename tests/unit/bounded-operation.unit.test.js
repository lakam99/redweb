'use strict';

const { BoundedOperation } = require('../../src/async/BoundedOperation');

test.each([false, true])('a delivered timeout remains terminal before the clock deadline (later cancellation=%s)', async cancelLater => {
    // Unit-only scheduler control reproduces the timer/clock disagreement;
    // real admission timeout/capacity/settlement tests remain unchanged.
    jest.useFakeTimers({ doNotFake: ['performance'] });
    let release, checkpoint, signal, observedDuringAbort, laterCalls = 0;
    const boundary = new BoundedOperation(60000);
    const external = new AbortController();
    const pending = boundary.run(async (operationSignal, check) => {
        signal = operationSignal; checkpoint = check;
        signal.addEventListener('abort', () => {
            try { check(); } catch (error) { observedDuringAbort = error; }
        });
        await new Promise(resolve => { release = resolve; });
        check(); laterCalls++;
    }, external.signal).catch(error => error);
    try {
        await Promise.resolve();
        expect(checkpoint).toBeDefined();
        jest.advanceTimersByTime(60000);
        if (cancelLater) external.abort();
        const failure = await pending;
        expect(failure.reason).toBe('timeout');
        expect(signal.aborted).toBe(true);
        expect(observedDuringAbort).toBe(failure);
        expect(checkpoint).toThrow(failure);
        try { checkpoint(); } catch (error) { expect(error).toBe(failure); }
    } finally {
        release?.();
        await Promise.resolve();
        await Promise.resolve();
        jest.useRealTimers();
    }
    expect(laterCalls).toBe(0);
});

test('the entry checkpoint catches cancellation during listener registration', async () => {
    const external = new AbortController();
    const add = external.signal.addEventListener.bind(external.signal);
    const registration = jest.spyOn(external.signal, 'addEventListener').mockImplementation((...args) => {
        external.abort(); // Unit injection between the first check and enrollment.
        add(...args);
    });
    const operation = jest.fn();
    try {
        await expect(new BoundedOperation().run(operation, external.signal)).rejects.toMatchObject({ reason: 'cancelled' });
        expect(operation).not.toHaveBeenCalled();
    } finally { registration.mockRestore(); }
});
