const ReactiveRenderer = require('../../src/htmx/ReactiveRenderer');
const LivePage = require('../../src/htmx/LivePage');
const { state } = require('../..');
const { jsxDEV } = require('../../jsx-dev-runtime');

describe('reactive renderer pure capture and lifecycle units', () => {
    const renderers = [];
    afterEach(() => { for (const renderer of renderers.splice(0)) renderer.dispose(); });
    function renderer(timeout) {
        const value = new ReactiveRenderer({}, new AbortController().signal, timeout);
        value.document = require('../../src/htmx/HtmlRenderer').document;
        renderers.push(value);
        return value;
    }
    const context = callback => callback();

    test('captures owners once per render and preserves safe keyed fragments', async () => {
        const value = renderer();
        let calls = 0;
        const child = {};
        const html = await value.initialize(() => {
            const render = () => { calls += 1; return jsxDEV('b', { children: 'one' }, '--unsafe-->').toString(); };
            return ReactiveRenderer.component(child, 'first', render) + ReactiveRenderer.component(child, 'first', render);
        }, context);
        expect(calls).toBe(1);
        expect(value.enabled).toBe(true);
        expect(html).not.toContain('unsafe-->');
        expect(html).toContain('<!--rw:k');
        expect(html.match(/<!--rw:c/g)).toHaveLength(2);
        expect(ReactiveRenderer.key('text', {})).toBe('text');
    });

    test('validates active keys and refuses state mutations during a render', async () => {
        const value = renderer();
        for (const key of [{}, 'a'.repeat(257)]) {
            await expect(value.initialize(() => ReactiveRenderer.key('x', key), context)).rejects.toThrow('JSX keys');
        }
        await expect(value.initialize(() => ReactiveRenderer.key('x', null), context)).resolves.toBe('x');
        await expect(value.initialize(() => ReactiveRenderer.key('x', undefined), context)).resolves.toBe('x');
        await expect(value.initialize(() => jsxDEV('ul', { children: [
            jsxDEV('li', { children: 'a' }, 'same'), [jsxDEV('li', { children: 'b' }, 'same')],
        ] }).toString(), context)).rejects.toThrow('Duplicate JSX sibling key');
        await expect(value.initialize(() => jsxDEV('p', { children: 'null key', key: null }).toString(), context)).resolves.toBe('<p>null key</p>');
        class Page { count = 0; }
        state()(Page.prototype, 'count');
        const page = LivePage.adopt(new Page());
        LivePage.activate(page);
        await expect(value.initialize(() => { page.count++; return 'x'; }, context)).rejects.toThrow('cannot be modified');
        expect(page.count).toBe(0);
        await page.dispose();
    });

    test('bounds markup, owner counts, and asynchronous render time', async () => {
        const value = renderer(10);
        await expect(value.initialize(() => 'x'.repeat(1024 * 1024 + 1), context)).rejects.toThrow('1 MiB');
        await expect(value.initialize(() => new Promise(() => {}), context)).rejects.toThrow('time limit');
        await expect(value.initialize(() => {
            for (let i = 0; i < 1024; i++) ReactiveRenderer.component({}, `child${i}`, () => 'x');
            return '';
        }, context)).rejects.toThrow('1024 owner');
    });

    test('rejects oversized subtree commits without changing the existing tree', async () => {
        const value = renderer();
        await value.initialize(() => {
            for (let i = 0; i < 1023; i++) ReactiveRenderer.component({}, `child${i}`, () => 'x');
            return '';
        }, context);
        const id = `c${Buffer.from('child0').toString('hex')}`;
        const replacement = new Map([[id, value.node({}, id, () => '')], ['extra', value.node({}, 'extra', () => '')]]);
        expect(() => value.commit(id, replacement)).toThrow('1024 owner');
        expect(value.nodes.size).toBe(1024);
    });

    test('parent cancellation aborts pending work and disposal suppresses later changes', async () => {
        const controller = new AbortController();
        const value = new ReactiveRenderer({}, controller.signal);
        renderers.push(value);
        const work = value.initialize(() => new Promise(() => {}), context);
        await Promise.resolve();
        controller.abort();
        await expect(work).rejects.toThrow('cancelled');
        value.invalidate({}, 'count', { name: 'count', value: '2' });
        value.schedule();
        expect(value.states.size).toBe(0);
        expect(value.controller.signal.aborted).toBe(true);
        const alreadyAborted = new ReactiveRenderer({}, controller.signal);
        expect(alreadyAborted.disposed).toBe(true);
        await expect(alreadyAborted.initialize(() => 'x', context)).rejects.toThrow('cancelled');
        alreadyAborted.dispose();
    });

    test('counts ancestor snapshots in the memory bound and leaves the old tree intact', async () => {
        const value = renderer();
        let text = 'small';
        await value.initialize(() => ReactiveRenderer.component({}, 'small', () => text) + 'x'.repeat(500000), context);
        const id = `c${Buffer.from('small').toString('hex')}`;
        const before = value.nodes;
        text = 'b'.repeat(600000);
        const stage = await value.renderNode(value.nodes.get(id));
        expect(() => value.commit(id, stage)).toThrow('1 MiB');
        expect(value.nodes).toBe(before);
    });

    test('coalesces parent/child invalidations and handles removed owners in a later batch', async () => {
        const value = renderer();
        const child = {};
        const second = {};
        let visible = true;
        let unblock;
        let entered;
        let blocking = false;
        await value.initialize(async () => {
            ReactiveRenderer.jsx();
            ReactiveRenderer.read(value.page, 'rootState');
            if (blocking) {
                entered();
                await new Promise(resolve => { unblock = resolve; });
            }
            return visible ? ReactiveRenderer.component(child, 'child', () => {
                ReactiveRenderer.read(child, 'count');
                return ReactiveRenderer.component(second, 'child.second', () => { ReactiveRenderer.read(second, 'count'); return 'x'; });
            }) : 'hidden';
        }, context);
        // Parents win regardless of invalidation order; unchanged output is suppressed without a socket.
        for (const order of [[child, value.page, second], [value.page, second, child]]) {
            for (const owner of order) value.invalidate(owner, owner === value.page ? 'rootState' : 'count', { name: 'unused' });
            const flushing = value.flush();
            expect(value.flush()).toBe(flushing);
            await flushing;
        }
        blocking = true;
        const started = new Promise(resolve => { entered = resolve; });
        value.invalidate(value.page, 'rootState', { name: 'unused' });
        const flushing = value.flush();
        await started;
        visible = false;
        value.invalidate(child, 'count', { name: 'unused' });
        unblock();
        await flushing;
        await value.flush();
        expect(value.nodes.size).toBe(1);
    });

    test('cancellation between render completion and commit never restores disposed snapshots', async () => {
        const initial = renderer();
        await expect(initial.initialize(() => {
            queueMicrotask(() => initial.dispose());
            return 'x';
        }, context)).rejects.toThrow('cancelled');
        const value = renderer();
        let cancel = false;
        await value.initialize(() => {
            ReactiveRenderer.read(value.page, 'value');
            if (cancel) queueMicrotask(() => value.dispose());
            return 'x';
        }, context);
        cancel = true;
        value.invalidate(value.page, 'value', { name: 'value' });
        await value.flush();
        expect(value.nodes.size).toBe(0);
    });
});
