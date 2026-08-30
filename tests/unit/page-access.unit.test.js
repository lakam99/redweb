'use strict';
const { PageIdentity, isPrincipal } = require('../../src/htmx/PageIdentity');
const PageLifetime = require('../../src/htmx/PageLifetime');
const snapshot = require('../../src/htmx/RequestSnapshot');
const { PageManager } = require('../../src/htmx/PageManager');
const { page, component, action, LivePage } = require('../..');

describe('page request identity and lifetimes', () => {
    test('copies bounded portable data without retaining or mutating request objects', () => {
        const request = { path: '/docs', url: '/docs?q=x', method: 'GET', headers: { names: ['one', 'two'] }, query: { nested: { value: 'original' }, count: 3, valid: true }, body: null, response: { secret: true } };
        const copied = snapshot(request);
        request.query.nested.value = 'changed';
        expect(copied.query.nested.value).toBe('original');
        expect(copied.response).toBeUndefined();
        expect(copied.get('Names')).toBe('one, two');
        expect(copied.get('missing')).toBeUndefined();
        expect(copied.get('__proto__')).toBeUndefined();
        expect(Object.isFrozen(copied.headers.names)).toBe(true);
        expect(snapshot({}).params).toEqual({});
        expect(snapshot({ body: Object.create(null) }).body).toEqual({});
        for (const value of [new Date(), () => {}, Symbol(), NaN, Infinity]) expect(() => snapshot({ body: value })).toThrow('JSON-compatible');
        expect(() => snapshot({ body: 'x'.repeat(65537) })).toThrow('64 KiB');
        expect(() => snapshot({ body: Array(10000).fill(null) })).toThrow('64 KiB');
        expect(() => snapshot({ body: Array(8192).fill(null) })).toThrow('64 KiB');
        const cyclic = {}; cyclic.self = cyclic;
        expect(() => snapshot({ body: cyclic })).toThrow('nesting');
    });

    test('requires authenticated primitives and contains identity failures', async () => {
        for (const value of ['alice', '', 0, 3n, true]) {
            expect(isPrincipal(value)).toBe(true);
            expect(await new PageIdentity(() => value).resolve({})).toBe(value);
        }
        for (const value of [false, null, undefined, {}, Symbol(), () => {}, NaN, Infinity]) {
            expect(isPrincipal(value)).toBe(false);
            await expect(new PageIdentity(() => value).resolve({})).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED', status: 401 });
        }
        await expect(new PageIdentity().resolve({})).resolves.toBeUndefined();
        expect(() => new PageIdentity(false)).toThrow('function');
        expect(() => new PageIdentity(undefined, 1)).toThrow('requires authenticate');
        await expect(new PageIdentity(() => { throw new Error('secret'); }).resolve({})).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED', status: 500 });
        await expect(new PageIdentity(() => new Promise(() => {}), 5).resolve({})).rejects.toMatchObject({ code: 'AUTHENTICATION_TIMEOUT', status: 503 });
        const controller = new AbortController(); controller.abort();
        await expect(new PageIdentity(() => 'alice').resolve({}, controller.signal)).rejects.toMatchObject({ code: 'AUTHENTICATION_CANCELLED', status: 503 });
    });

    test('cancels before work, during work, and after a result without swallowing operation failures', async () => {
        const parent = new AbortController();
        const lifetime = new PageLifetime(parent.signal);
        expect(await lifetime.wait(() => 3)).toBe(3);
        await expect(lifetime.wait(() => { throw new Error('application error'); })).rejects.toThrow('application error');
        const pending = lifetime.wait(() => new Promise(() => {}));
        parent.abort();
        await expect(pending).rejects.toMatchObject({ code: 'ACCESS_CANCELLED' });
        const already = new PageLifetime(parent.signal);
        await expect(already.wait(() => { throw new Error('must not run'); })).rejects.toMatchObject({ code: 'ACCESS_CANCELLED' });
        const late = new PageLifetime(new AbortController().signal);
        await expect(late.wait(() => { late.abort(); return 1; })).rejects.toMatchObject({ code: 'ACCESS_CANCELLED' });
    });

    test('legacy methods also recheck lifetime after their last asynchronous guard', async () => {
        class Page extends LivePage { run() { throw new Error('must not run'); } }
        action()(Page.prototype, 'run', Object.getOwnPropertyDescriptor(Page.prototype, 'run'));
        const instance = new Page();
        await expect(LivePage.invoke(instance, 'run', [], {}, () => instance.dispose())).rejects.toMatchObject({ code: 'ACTION_CANCELLED' });
    });

    test('rejects orphan page policy deadlines and invalid revocation identities', async () => {
        expect(() => page('/', { authorizationTimeoutMs: 5 })).toThrow('requires authorize');
        class Page { render() { return '<p>page</p>'; } }
        page('/')(Page);
        const manager = new PageManager({ pages: [Page] });
        try { await expect(manager.revoke(false)).rejects.toThrow('identity'); }
        finally { await manager.shutdown(); }
    });

    test.each(['abort', 'dispose'])('does not load later children after %s', async mode => {
        let finish, later = 0;
        class First { loading() { return new Promise(resolve => { finish = resolve; }); } }
        class Second { loading() { later += 1; } }
        component()(First); component()(Second);
        class Page extends LivePage { first = new First(); second = new Second(); }
        const instance = new Page(); instance._activateState();
        const controller = new AbortController();
        const pending = instance._loadComponents({ signal: controller.signal });
        if (mode === 'abort') controller.abort(); else await instance.dispose();
        finish(); await pending;
        expect(later).toBe(0);
        await instance.dispose();
    });

    test('rejects already-cancelled render and connection work', async () => {
        class Page extends LivePage { render() { return '<p>page</p>'; } }
        page('/')(Page);
        const manager = new PageManager({ pages: [Page] });
        const controller = new AbortController(); controller.abort();
        try {
            await expect(manager.render(manager.records.get('/'), {}, controller.signal)).rejects.toMatchObject({ code: 'ACCESS_CANCELLED' });
            const instance = new Page();
            expect(() => instance._attach({}, { signal: controller.signal })).toThrow();
            const session = manager.createSession(instance, true);
            await expect(manager.connect(session, { context: { signal: controller.signal } })).rejects.toMatchObject({ code: 'ACCESS_CANCELLED' });
        } finally { await manager.shutdown(); }
    });
});
