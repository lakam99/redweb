'use strict';

const { RecoveryWorkerBoundary } = require('../helpers/RecoveryWorkerBoundary');

// Explicit process/clock/GC unit boundary, not native memory or IPC evidence.
async function failedReply(value, command = 'sample') {
    const worker = new RecoveryWorkerBoundary({ gcError: value });
    try { return await worker.request(command, { phase: 'unit' }); }
    finally { worker.collect(); }
}

test.each([undefined, null, false, 0, '', 'unit rejection'])('worker serializes a non-Error rejection as a failure: %s', async value => {
    const reply = await failedReply(value);
    expect(typeof reply.error).toBe('string');
    expect(reply.error.length).toBeGreaterThan(0);
    expect(reply).not.toHaveProperty('result');
});

test('worker error reporting never invokes a rejected object coercion hook', async () => {
    const reply = await failedReply({ toString() { throw new Error('Do not coerce rejected objects'); } });
    expect(reply.error).toContain('non-Error value');
});

test('private snapshot refusal remains redacted', async () => {
    expect(await failedReply('private contents', 'snapshot')).toEqual({ error: 'Private heap capture failed' });
});

test.each([undefined, ''])('worker retains failure when a genuine Error has no usable stack: %s', async stack => {
    const error = new Error('Missing stack');
    error.stack = stack;
    expect(await failedReply(error)).toEqual({ error: 'Diagnostic worker failed' });
});
