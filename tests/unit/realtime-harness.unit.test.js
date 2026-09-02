'use strict';

const { EventEmitter } = require('node:events');

test('unit fault: failed acquisition preserves the original and cleanup failures', async () => {
    const primary = new Error('unit handshake failure');
    const cleanup = new Error('unit socket close failure');
    let peer;
    class Socket extends EventEmitter {
        static CLOSED = 3;
        constructor() {
            super(); peer = this; this.readyState = 0;
            queueMicrotask(() => this.emit('error', primary));
        }
        close() { throw cleanup; }
        terminate() { this.readyState = Socket.CLOSED; this.emit('close'); }
    }
    try {
        let openClient;
        jest.isolateModules(() => {
            jest.doMock('ws', () => Socket);
            ({ openClient } = require('../../scripts/realtime-harness'));
        });
        const failure = await openClient('unit-only').catch(error => error);
        expect(failure).toBeInstanceOf(AggregateError);
        expect(failure.errors).toEqual([primary, cleanup]);
        expect(failure.cause).toBe(primary);
        expect(peer.readyState).toBe(Socket.CLOSED);
        expect(peer.listenerCount('close')).toBe(0);
        expect(peer.listenerCount('error')).toBe(0);
    } finally {
        jest.dontMock('ws');
    }
});

test('unit fault: synchronous close/termination errors preserve both and cancel observers', async () => {
    const { closeClient } = require('../../scripts/realtime-harness');
    const peer = new EventEmitter();
    const primary = new Error('unit close throw'), termination = new Error('unit terminate throw');
    peer.readyState = 2;
    peer.close = () => { throw primary; };
    peer.terminate = jest.fn(() => { throw termination; });
    const failure = await closeClient(peer).catch(error => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors.slice(0, 2)).toEqual([primary, termination]);
    expect(failure.errors[2].message).toContain('did not close');
    expect(failure.cause).toBe(primary);
    expect(peer.terminate).toHaveBeenCalledTimes(1);
    expect(peer.listenerCount('close')).toBe(0);
    expect(peer.listenerCount('error')).toBe(0);
});

test('unit fault: failed termination cannot report a still-open peer as closed', async () => {
    const { closeClient } = require('../../scripts/realtime-harness');
    const peer = new EventEmitter();
    peer.readyState = 2;
    peer.close = jest.fn(() => peer.emit('error', new Error('unit close failure')));
    peer.terminate = jest.fn(() => peer.emit('error', new Error('unit termination failure')));
    await expect(closeClient(peer)).rejects.toThrow('Socket did not close after termination');
    expect(peer.close).toHaveBeenCalledTimes(1);
    expect(peer.terminate).toHaveBeenCalledTimes(1);
    expect(peer.listenerCount('close')).toBe(0);
    expect(peer.listenerCount('error')).toBe(0);
});
