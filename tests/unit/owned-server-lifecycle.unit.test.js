'use strict';

const http = require('http');
const { EventEmitter } = require('events');
const OwnedServerLifecycle = require('../../src/OwnedServerLifecycle');
const { closeServer } = require('../../src/serverLifecycle');
const { start, page } = require('../..');

test('owned tracking cleans closed peers and disposes idempotently when never started', async () => {
    const server = http.createServer();
    const connections = server.listeners('connection');
    const owner = new OwnedServerLifecycle(server);
    const peer = new EventEmitter();
    server.emit('connection', peer);
    expect(owner.connections.has(peer)).toBe(true);
    peer.emit('close');
    expect(owner.connections.size).toBe(0);
    await owner.close(100, () => closeServer(server));
    owner.dispose();
    expect(server.listeners('connection')).toEqual(connections);
    expect(server.listenerCount('close')).toBe(0);
});

test('a close callback failure is propagated unchanged after successful force cleanup', async () => {
    const server = http.createServer();
    const owner = new OwnedServerLifecycle(server);
    const failure = new Error('close failure');
    await expect(owner.close(100, () => Promise.reject(failure))).rejects.toBe(failure);
    expect(server.listeners('connection')).not.toContain(owner.onConnection);
});

test('close errors remain primary while every failing force-close operation is attempted', async () => {
    const primary = new Error('original close failure');
    const listenerFailure = new Error('listener failure');
    const peerFailure = new Error('peer failure');
    class BrokenServer extends EventEmitter {
        listening = true;
        close() { throw listenerFailure; }
    }
    const server = new BrokenServer();
    const owner = new OwnedServerLifecycle(server);
    let attempted = 0;
    for (let index = 0; index < 2; index++) {
        const peer = new EventEmitter();
        peer.destroy = () => { attempted++; throw peerFailure; };
        server.emit('connection', peer);
    }
    await expect(owner.close(100, () => { throw primary; })).rejects.toMatchObject({
        cause: primary, errors: [primary, listenerFailure, peerFailure, peerFailure],
    });
    expect(attempted).toBe(2);
    owner.dispose();
});

test('deadline force-close reports errors and guards peers accepted before native close', async () => {
    class Server extends EventEmitter {
        listening = true;
        close() { this.listening = false; }
    }
    const server = new Server();
    const owner = new OwnedServerLifecycle(server);
    const failing = new EventEmitter();
    failing.destroy = () => { throw new Error('peer destroy failed'); };
    server.emit('connection', failing);
    await expect(owner.close(0, () => new Promise(() => {}))).rejects.toThrow('force-close failed');
    let lateDestroyed = false;
    const late = new EventEmitter();
    late.destroy = () => { lateDestroyed = true; late.emit('close'); };
    server.emit('connection', late);
    expect(lateDestroyed).toBe(true);
    failing.emit('close');
    server.emit('close');
    expect(owner.connections.size).toBe(0);
    expect(server.listenerCount('connection')).toBe(0);
});

test('Live HTML validates deferred listener options and constructor failures', () => {
    class Page { render() { return '<p>hello</p>'; } }
    page('/')(Page);
    expect(() => start(Page, { listen: 'invalid' })).toThrow('listen');
    expect(() => start(Page, { listen: false, heartbeat: { intervalMs: -1, timeoutMs: 1 } })).toThrow();
});
