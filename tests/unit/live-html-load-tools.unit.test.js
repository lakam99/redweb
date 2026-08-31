'use strict';

const http = require('node:http');
const { EventEmitter } = require('node:events');
const { withTimeout } = require('../helpers/network');
const config = { pageId: 'unit', socketPath: '/live', version: '1' };

// Explicit HTTP/transport boundary units. Native integration tests separately
// exercise actual peers, framing, deadlines, closure and the full CLI workload.
test.each(['valid', 'get-throw', 'request-error', 'response-error', 'request-destroy', 'response-destroy', 'close-timeout'])
('page reader retains %s boundary results and cleanup', async mode => {
    const request = new EventEmitter(), response = new EventEmitter();
    const primary = new Error('unit page failure');
    response.statusCode = 200;
    request.destroy = jest.fn(() => { request.emit('close'); if (mode === 'request-destroy') throw primary; });
    response.destroy = jest.fn(() => { if (mode === 'response-destroy') throw primary; });
    const get = jest.spyOn(http, 'get').mockImplementation((_options, received) => {
        if (mode === 'get-throw') throw primary;
        queueMicrotask(() => {
            if (mode === 'request-error') { request.emit('error', primary); return; }
            received(response);
            if (mode === 'response-error') { response.emit('error', primary); return; }
            response.emit('data', Buffer.from(`<script type="application/json" id="__redweb_page">${JSON.stringify(config)}</script>`));
            response.emit('end');
        });
        return request;
    });
    try {
        let read;
        jest.isolateModules(() => {
            jest.doMock('../helpers/network', () => ({ withTimeout: mode === 'close-timeout' ? () => Promise.reject(primary) : withTimeout }));
            read = require('../../scripts/lib/readLiveHtmlPage').readLiveHtmlPage;
        });
        if (mode === 'valid') expect(await read(1)).toEqual(config);
        else { const error = await read(1).catch(error => error); expect(error.cause).toBe(primary); expect(error.errors).toContain(primary); }
        if (mode !== 'get-throw') expect(request.destroy).toHaveBeenCalled();
        if (!['get-throw', 'request-error'].includes(mode)) expect(response.destroy).toHaveBeenCalled();
    } finally { get.mockRestore(); jest.dontMock('../helpers/network'); }
});

test('page configuration validation rejects each malformed field without escaping the promise', async () => {
    const values = [null, {}, { ...config, pageId: 1 }, { ...config, pageId: '' }, { ...config, socketPath: null },
        { ...config, socketPath: '//external' }, { ...config, socketPath: '/live?other' }, { ...config, version: null }, { ...config, version: '' }];
    for (const value of values) {
        const request = new EventEmitter(), response = new EventEmitter();
        request.destroy = () => request.emit('close'); response.destroy = () => {}; response.statusCode = 200;
        const get = jest.spyOn(http, 'get').mockImplementation((_options, receive) => {
            queueMicrotask(() => {
                receive(response);
                response.emit('data', Buffer.from(`<script type="application/json" id="__redweb_page">${JSON.stringify(value)}</script>`)); response.emit('end');
            });
            return request;
        });
        try { await expect(require('../../scripts/lib/readLiveHtmlPage').readLiveHtmlPage(1)).rejects.toThrow('configuration'); }
        finally { get.mockRestore(); }
    }
});

test.each(['healthy', 'latched-connect', 'client-close', 'socket-close', 'both-close', 'non-error'])
('client ownership retains %s and attempts every cleanup', async mode => {
    const listeners = {}, sockets = [];
    const primary = new Error('unit client failure');
    const rawClose = jest.fn(async () => { if (['socket-close', 'both-close'].includes(mode)) throw primary; });
    let owner;
    try {
        jest.isolateModules(() => {
            jest.doMock('../../scripts/realtime-harness', () => ({ WebSocket: class { constructor() { sockets.push(this); } }, closeClient: rawClose }));
            jest.doMock('redweb-client', () => ({ RedwebClient: class {
                constructor(_url, options) { this.options = options; }
                onError(fn) { listeners.transportError = fn; }
                onClose(fn) { listeners.close = fn; }
                on(name, fn) { listeners[name] = fn; }
                async connect() { this.options.webSocketFactory('ws://unit'); if (mode === 'latched-connect') listeners.transportError(primary); }
                close() { if (mode === 'non-error') throw null; if (['client-close', 'both-close'].includes(mode)) throw primary; }
            } }));
            owner = new (require('../../scripts/lib/LiveHtmlLoadClient').LiveHtmlLoadClient)(1, config, []);
        });
        if (mode === 'latched-connect') await expect(owner.connect()).rejects.toBe(primary);
        else await owner.connect();
        listeners.transportError(primary); listeners.transportError(new Error('later'));
        expect(() => owner.check()).toThrow(primary);
        if (['client-close', 'socket-close', 'both-close', 'non-error'].includes(mode)) {
            const error = await owner.close().catch(error => error);
            expect(error).toBeInstanceOf(AggregateError); expect(error.errors).toHaveLength(mode === 'both-close' ? 2 : 1);
            expect(owner.sockets.size).toBe(1);
        } else { await owner.close(); expect(owner.sockets.size).toBe(0); }
        expect(rawClose).toHaveBeenCalledWith(sockets[0]);
        listeners.transportError(new Error('expected during cleanup')); expect(owner.failure).toBe(primary);
    } finally { jest.dontMock('redweb-client'); jest.dontMock('../../scripts/realtime-harness'); }
});

test('patch shape failures latch while valid native-shaped data remains readable', () => {
    const listeners = {}, updates = [];
    try {
        let Owner;
        jest.isolateModules(() => {
            jest.doMock('redweb-client', () => ({ RedwebClient: class {
                onError() {} onClose() {} on(name, listener) { listeners[name] = listener; }
            } }));
            Owner = require('../../scripts/lib/LiveHtmlLoadClient').LiveHtmlLoadClient;
        });
        for (const payload of [undefined, {}, { patches: null }, { patches: [] }, { patches: [null] }, { patches: [{ html: 1 }] }]) {
            const owner = new Owner(1, config, updates);
            listeners['redweb:patch']({ payload }); expect(() => owner.check()).toThrow('patch');
        }
        const owner = new Owner(1, config, updates);
        listeners['redweb:patch']({ payload: { patches: [{ html: 'valid' }] } });
        owner.check(); expect(updates).toEqual([{ html: 'valid' }]);
    } finally { jest.dontMock('redweb-client'); }
});
