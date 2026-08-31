'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = path.resolve(__dirname, '../../scripts/diagnostics/recovery-split-worker.cjs');

// Explicit process/clock/GC unit boundary, not native memory or IPC evidence.
async function failedReply(value, command = 'sample') {
    const handlers = new Map();
    const replies = [];
    const context = {
        require: createRequire(filename),
        process: { argv: ['node', filename, 'client'], execArgv: [],
            on: (event, handler) => handlers.set(event, handler), send: reply => replies.push(reply) },
        global: { gc: () => { throw value; } },
        setTimeout: callback => callback(), setImmediate: callback => callback(),
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    await handlers.get('message')({ command, phase: 'unit' });
    expect(replies).toHaveLength(1);
    return replies[0];
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
