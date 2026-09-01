'use strict';

const loopbackRequest = require('../../src/development/loopbackRequest');
const settings = require('../../src/development/settings');
const { start, page, SocketServer } = require('../..');
const DevelopmentPageManager = require('../../src/development/DevelopmentPageManager');
const { PageManager } = require('../../src/htmx/PageManager');

test('document decoration preserves serialization before static page disposal', async () => {
    for (const Manager of [PageManager, DevelopmentPageManager]) {
        const calls = [];
        class Page {
            render() { return '<p>hello</p>'; }
            disposed() { calls.push('disposed'); }
        }
        page('/', { live: false })(Page);
        class OrderedManager extends Manager {
            createDocument(...args) {
                const document = super.createDocument(...args);
                return (...values) => { calls.push('document'); return document(...values); };
            }
        }
        const manager = new OrderedManager({ pages: [Page] });
        try {
            await manager.render(manager.records.get('/'), {});
            expect(calls).toEqual(['document', 'disposed']);
        } finally { await manager.shutdown(); }
    }
});

test('refresh preserves path validation and reserves its resources before registration', async () => {
    class Page { render() { return ''; } }
    page('/', { live: false })(Page);
    for (const paths of [null, [], 'invalid']) {
        expect(() => new DevelopmentPageManager({ pages: [Page], paths })).toThrow('paths');
    }
    for (const reserved of ['/__redweb/development', '/__redweb/development.js', '/__redweb/development.css']) {
        class ReservedPage { render() { return ''; } }
        page(reserved, { live: false })(ReservedPage);
        expect(() => new DevelopmentPageManager({ pages: [ReservedPage] })).toThrow('reserved');
        expect(() => new DevelopmentPageManager({ pages: [Page], paths: { runtime: reserved } })).toThrow('unique');
    }
    expect(() => new DevelopmentPageManager({ pages: [Page], paths: { css: '/__redweb' } })).toThrow('contain');
});

test('development options validate explicitly and production refuses environment-enabled refresh', async () => {
    const environment = { NODE_ENV: process.env.NODE_ENV, REDWEB_DEV_REFRESH: process.env.REDWEB_DEV_REFRESH };
    class Page { render() { return '<p>hello</p>'; } }
    page('/', { live: false })(Page);
    try {
        expect(settings(undefined)).toEqual({});
        expect(settings({ inspect: undefined })).toEqual({});
        expect(settings({ inspect: false })).toEqual({ inspect: false });
        for (const input of [null, [], true, { refresh: true }, { inspect: 'true' }]) expect(() => settings(input)).toThrow('development');
        process.env.REDWEB_DEV_REFRESH = '1';
        const dev = start(Page, { listen: false });
        expect(dev.manager).toBeInstanceOf(DevelopmentPageManager);
        await dev.shutdown();
        process.env.NODE_ENV = 'production';
        expect(() => start(Page, { listen: false })).toThrow('production');
        expect(() => start(Page, { listen: false, development: { refresh: true } })).toThrow('production');
        const disabled = start(Page, { listen: false, development: { refresh: false } });
        expect(disabled.manager).not.toBeInstanceOf(DevelopmentPageManager);
        await disabled.shutdown();
        expect(() => new SocketServer({ listen: false, development: { refresh: true } })).toThrow('development');
    } finally {
        for (const [name, value] of Object.entries(environment)) {
            if (value === undefined) delete process.env[name]; else process.env[name] = value;
        }
    }
});

test('development access trusts only actual loopback peers and literal matching local origins', () => {
    const request = (host = '127.0.0.1:8181', remoteAddress = '127.0.0.1', extra = {}, port = 8181, encrypted = false) => ({
        socket: { remoteAddress, localPort: port, encrypted }, headers: { host, ...extra },
    });
    expect(loopbackRequest(request())).toBe(true);
    expect(loopbackRequest(request('LOCALHOST:8181', '::ffff:127.0.0.1', { origin: 'http://localhost:8181', 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(loopbackRequest(request('[::1]', '::1', { origin: 'https://[::1]', 'sec-fetch-site': 'none' }, 443, true))).toBe(true);
    expect(loopbackRequest(request('localhost', '127.0.0.1', {}, 80))).toBe(true);
    for (const host of ['localhost:9999', '127.1:8181', 'localhost.evil:8181', 'example.test:8181', 'user@localhost:8181', '127.999.0.1:8181', ['localhost']]) {
        expect(loopbackRequest(request(host))).toBe(false);
    }
    for (const address of ['10.0.0.1', '::ffff:10.0.0.1', '']) expect(loopbackRequest(request(undefined, address))).toBe(false);
    expect(loopbackRequest({})).toBe(false);
    expect(loopbackRequest({ socket: { remoteAddress: '127.0.0.1' } })).toBe(false);
    for (const extra of [{ origin: 'null' }, { origin: 'https://127.0.0.1:8181' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]) {
        expect(loopbackRequest(request(undefined, undefined, extra))).toBe(false);
    }
});

test('the refresh document factory decorates complete and malformed HTML without retaining a request', async () => {
    class Page { render() { return ''; } }
    page('/', { live: false })(Page);
    const manager = new DevelopmentPageManager({ pages: [Page] });
    try {
        const request = { socket: { remoteAddress: '::1', localPort: 80 }, headers: { host: 'localhost' } };
        const render = manager.createDocument(manager.records.get('/'), request);
        request.headers.host = 'untrusted.invalid';
        expect(render('<h1>hello</h1>', null)).toContain(`?revision=${manager.revision}`);
        expect(render('<script>', null)).toContain('__redweb_dev');
        expect(manager.createDocument(manager.records.get('/'), request)('<h1>hello</h1>', null)).not.toContain('__redweb_dev');
    } finally { await manager.shutdown(); }
});
