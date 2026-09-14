'use strict';

const http = require('http');
const { Inspection, createInspection } = require('../../src/development/Inspection');
const { list, members, text, freeze } = require('../../src/development/description');
const { start, page, state, SocketServer } = require('../..');
const LivePage = require('../../src/htmx/LivePage');
const { ReactivePage } = require('../fixtures/reactive-pages');
const dataProperty = require('../../src/dataProperty');

test('explicit options reject production before constructing applications or attaching listeners', async () => {
    expect(createInspection(undefined)).toBeNull();
    expect(createInspection({})).toBeNull();
    expect(createInspection({ inspect: false })).toBeNull();
    for (const value of [null, false, [], 'yes', { typo: true }, { inspect: 1 }]) expect(() => createInspection(value)).toThrow('development');
    const previous = process.env.NODE_ENV;
    const listener = http.createServer();
    let constructed = 0;
    class Page { constructor() { constructed++; } }
    page('/', { shared: true })(Page);
    try {
        process.env.NODE_ENV = 'production';
        expect(() => start(Page, { listen: false, development: { inspect: true } })).toThrow('production');
        expect(() => new SocketServer({ server: listener, development: { inspect: true } })).toThrow('production');
        expect(constructed).toBe(0);
        expect(listener.listenerCount('upgrade')).toBe(0);
    } finally {
        if (previous === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous;
        listener.close();
    }
    const server = new SocketServer({ listen: false });
    expect(server.inspect()).toBeNull();
    await server.shutdown();
});

test('descriptions bound list/string sizes and a shared nested budget without reading values', () => {
    expect(dataProperty(Object.create({ inherited: 1 }), 'inherited')).toBe(1);
    expect(dataProperty(1, 'missing')).toBeUndefined();
    const values = Array.from({ length: 120 }, (_, index) => String(index));
    expect(list(values)).toMatchObject({ total: 120, truncated: true });
    expect(list(values).items).toHaveLength(100);
    const budget = { remaining: 3 };
    const nested = list(['outer', 'second'], name => ({ name, children: list(values, undefined, budget) }), budget);
    expect(nested.items).toHaveLength(1);
    expect(nested.items[0].children.items).toHaveLength(2);
    expect(nested.truncated).toBe(true);
    expect(budget.remaining).toBe(0);
    expect(text('x'.repeat(300))).toHaveLength(128);
    expect(text({ toString() { throw new Error('must not stringify'); } })).toBe('[unavailable]');
    expect(freeze(null)).toBeNull();
    expect(freeze({ items: ['safe'] }).items).toEqual(['safe']);
    class Page {}
    state()(Page.prototype, 'secret');
    expect(members(Page).states.items).toEqual(['secret']);
});

test('journals retain only immutable names with bounded history, including disposed invalidations', () => {
    const inspection = new Inspection();
    const instance = LivePage.adopt(new ReactivePage());
    LivePage.activate(instance);
    expect(LivePage.describe(instance).components.items).toHaveLength(4);
    const renderer = new inspection.Renderer(instance, new AbortController().signal);
    const payload = { component: 'primary', get value() { throw new Error('secret value accessed'); } };
    try {
        for (let index = 0; index < 300; index++) renderer.invalidate(instance, 'items', payload);
        expect(inspection.events).toHaveLength(256);
        expect(inspection.events[0].sequence).toBe(45);
        expect(inspection.events.at(-1).component).toBe('primary');
        expect(Object.isFrozen(inspection.events[0])).toBe(true);
        expect(JSON.stringify(inspection.events)).not.toContain('secret value');
        const id = inspection.id(renderer);
        expect(inspection.id(renderer)).toBe(id);
        renderer.dispose();
        renderer.invalidate(instance, 'items', payload);
        expect(inspection.events).toHaveLength(256);
        expect(inspection.sequence).toBe(300);
    } finally { renderer.dispose(); }
});

test('journal and snapshot description failures remain contained and do not expose exception text', async () => {
    const inspection = new Inspection();
    const renderer = new inspection.Renderer({}, new AbortController().signal);
    Object.defineProperty(renderer, 'page', { configurable: true, get() { throw new Error('sensitive diagnostic'); } });
    expect(() => inspection.record(renderer, 'flush-failed', {})).not.toThrow();
    expect(inspection.events[0].route).toBe('[unavailable]');
    Object.freeze(inspection.events);
    expect(() => inspection.record(renderer, 'flush-failed', {})).not.toThrow();
    expect(inspection.events).toHaveLength(1);
    Object.defineProperty(renderer, 'page', { configurable: true, writable: true, value: {} });
    renderer.dispose();
    const server = start(ReactivePage, { listen: false, development: { inspect: true } });
    const record = server.manager.records.get('/');
    const original = record.PageClass;
    Object.defineProperty(record, 'PageClass', { configurable: true, get() { throw new Error('private stack'); } });
    try {
        const snapshot = server.inspect();
        expect(snapshot.pages.registrations.items[0].className).toBe('[unavailable]');
        expect(snapshot.sockets.available).toBe(true);
        expect(JSON.stringify(snapshot)).not.toContain('private stack');
        const records = server.manager.records;
        server.manager.records = null;
        expect(server.inspect().pages).toEqual({ available: false });
        server.manager.records = records;
    } finally {
        Object.defineProperty(record, 'PageClass', { configurable: true, writable: true, value: original });
        await server.shutdown();
    }
});

test('snapshot metadata uses one global item budget across pages and nested member lists', async () => {
    const pages = Array.from({ length: 20 }, (_, index) => {
        class Page { render() { return ''; } }
        for (let field = 0; field < 120; field++) state()(Page.prototype, `field${field}`);
        page(`/page-${index}`)(Page);
        return Page;
    });
    const server = start(pages, { listen: false, development: { inspect: true } });
    try {
        const snapshot = server.inspect();
        let items = 0;
        const visit = value => {
            if (!value || typeof value !== 'object') return;
            if (Array.isArray(value.items)) items += value.items.length;
            Object.values(value).forEach(visit);
        };
        visit(snapshot);
        expect(items).toBeLessThanOrEqual(1000);
        expect(snapshot.pages.registrations.truncated).toBe(true);
        expect(snapshot.sockets.routes.truncated).toBe(true);
    } finally { await server.shutdown(); }
});
