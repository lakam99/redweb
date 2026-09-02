'use strict';

const { EventEmitter } = require('node:events');
const { performProbeAction } = require('../../scripts/lib/performProbeAction');
const reply = { v: 'unit', requestId: 'probe', type: 'redweb:result', payload: true };

// Explicit synchronous transport faults; native peers are covered separately.
test.each(['success', 'unrelated', 'null', 'array', 'number', 'json', 'version', 'type', 'payload',
    'send', 'error', 'close', 'timeout', 'late-error', 'latched-error'])('packed action unit: %s', async mode => {
    jest.useFakeTimers();
    const socket = new EventEmitter();
    const original = () => {};
    for (const event of ['message', 'error', 'close']) socket.on(event, original);
    socket.send = wire => {
        expect(JSON.parse(wire)).toEqual({ v: 'unit', requestId: 'probe', type: 'redweb:html',
            payload: { kind: 'action', component: 'chat', name: 'join', args: [{ name: 'Packed visitor' }] } });
        if (mode === 'send') throw new Error('send failed');
        if (mode === 'timeout') return;
        if (mode === 'close') return socket.emit('close');
        if (mode === 'error') return socket.emit('error', 'transport failed');
        if (mode === 'latched-error') {
            socket.emit('error', new Error('first failure'));
            socket.emit('error', new Error('second failure'));
            socket.emit('message', JSON.stringify(reply)); return;
        }
        if (mode === 'unrelated') socket.emit('message', JSON.stringify({ type: 'state' }));
        const invalid = { null: 'null', array: '[]', number: '3', json: '{',
            version: JSON.stringify({ ...reply, v: 'other' }), type: JSON.stringify({ ...reply, type: 'other' }),
            payload: JSON.stringify({ ...reply, payload: false }) };
        socket.emit('message', invalid[mode] || Buffer.from(JSON.stringify(reply)));
        if (mode === 'late-error') socket.emit('error', new Error('late failure'));
    };
    try {
        const result = performProbeAction(socket, 'unit');
        const check = ['success', 'unrelated'].includes(mode) ? expect(result).resolves.toBeUndefined()
            : expect(result).rejects.toThrow(mode === 'latched-error' ? 'first failure' : undefined);
        if (mode === 'timeout') await jest.advanceTimersByTimeAsync(5000);
        await check;
        expect(jest.getTimerCount()).toBe(0);
        for (const event of ['message', 'error', 'close']) expect(socket.listeners(event)).toEqual([original]);
    } finally { jest.useRealTimers(); }
});
