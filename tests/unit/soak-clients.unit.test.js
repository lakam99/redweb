'use strict';

const { EventEmitter } = require('node:events');

// Explicit transport/cleanup boundary units; native WebSocket tests are separate.
async function withTransport(mode, exercise) {
    const sockets = []; let closeFails = mode === 'close-failure';
    class Socket extends EventEmitter {
        static OPEN = 1;
        constructor() { super(); this.readyState = 1; sockets.push(this); }
        send(value) { this.payload = JSON.parse(value); if (mode === 'send-failure') throw new Error('unit send failure'); }
    }
    const closeClient = async socket => {
        if (closeFails) throw 'unit close failure';
        socket.emit('error', new Error('intentional close error'));
        socket.readyState = 3; socket.emit('close');
    };
    let clients;
    const fail = jest.fn();
    try {
        jest.isolateModules(() => {
            jest.doMock('../../scripts/realtime-harness', () => ({ WebSocket: Socket, closeClient,
                waitFor: async () => { if (mode === 'open-failure') throw new Error('unit open failure'); } }));
            const { SoakClients } = require('../../scripts/lib/SoakClients');
            clients = new SoakClients('unit://socket', 2, fail);
        });
        await exercise(clients, sockets, fail, () => { closeFails = false; });
    } finally {
        closeFails = false; await clients?.closeAll(); jest.dontMock('../../scripts/realtime-harness');
    }
}

test('soak owner preserves ticks/generations, skips intended closure and stops replacement during shutdown', () => withTransport('pass', async (clients, sockets) => {
    await clients.openInitial(); clients.sendTick(0);
    expect(sockets[0].payload).toEqual({ type: 'cycle', slot: 0, generation: 0, tick: 0 });
    sockets.forEach(socket => socket.emit('message', '{"tick":0}'));
    expect(clients.received).toBe(2);
    await clients.rotate(0, () => true);
    clients.sendTick(1); expect(clients.sent).toBe(3);
    clients.slots[1].closing = true; clients.sendTick(2); expect(clients.sent).toBe(3);
    await clients.rotate(1, () => false); expect(sockets).toHaveLength(3);
    clients.check();
}));

test.each(['open-failure', 'send-failure', 'close-failure'])('soak preserves %s and cleanup ownership', mode => withTransport(mode, async (clients, sockets, _fail, allowClose) => {
    if (mode === 'open-failure') await expect(clients.openInitial()).rejects.toThrow('unit open');
    else {
        await clients.openInitial();
        if (mode === 'send-failure') expect(() => clients.sendTick(0)).toThrow('unit send');
        else {
            await expect(clients.closeAll()).rejects.toThrow('unit close');
            expect(clients.records.size).toBe(2); allowClose();
        }
    }
    await clients.closeAll(); expect(clients.records.size).toBe(0);
    expect(sockets.every(socket => socket.readyState === 3)).toBe(true);
}));

test.each(['{', 'null', '[]', '1', '{"extra":1,"tick":0}', '{"tick":"0"}', '{"tick":1}', '{"tick":0.5}'])
('soak rejects malformed or unsent reply %s and preserves the first failure', raw => withTransport('pass', async (clients, sockets, fail) => {
    await clients.openInitial(); clients.sendTick(0); sockets[0].emit('message', raw);
    const failure = clients.failure;
    expect(require('node:util').types.isNativeError(failure)).toBe(true);
    sockets[0].emit('message', '{"tick":0}'); sockets[0].emit('error', new Error('later'));
    expect(clients.received).toBe(0); expect(fail).toHaveBeenCalledTimes(1);
    expect(() => clients.check()).toThrow(failure);
}));

test.each(['error', 'close'])('soak latches unexpected %s events', event => withTransport('pass', async (clients, sockets, fail) => {
    await clients.openInitial(); sockets[0].emit(event, 'unit transport error');
    expect(fail).toHaveBeenCalledTimes(1); expect(() => clients.check()).toThrow();
}));

test('soak unexpected close preserves the native close code and reason', () => withTransport('pass', async (clients, sockets, fail) => {
    await clients.openInitial();
    sockets[0].emit('close', 1013, Buffer.from('Slow consumer'));
    expect(() => clients.check()).toThrow('Soak client disconnected unexpectedly (code 1013, reason "Slow consumer").');
    expect(fail).toHaveBeenCalledTimes(1);
}));

test('soak close diagnostics escape controls and handle an absent code', () => withTransport('pass', async (clients, sockets) => {
    await clients.openInitial();
    sockets[0].emit('close', undefined, 'line one\nline two\t');
    expect(() => clients.check()).toThrow('Soak client disconnected unexpectedly (code unknown, reason "line one\\nline two\\t").');
}));

test('soak preserves an earlier transport error when close metadata arrives later', () => withTransport('pass', async (clients, sockets, fail) => {
    await clients.openInitial();
    const primary = new Error('primary transport failure');
    sockets[0].emit('error', primary);
    sockets[0].emit('close', 1013, Buffer.from('later close reason'));
    expect(() => clients.check()).toThrow(primary);
    expect(fail).toHaveBeenCalledTimes(1);
}));
