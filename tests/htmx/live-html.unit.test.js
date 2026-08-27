const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const Module = require('module');
const ts = require('typescript');
const {
    HtmxRenderer,
    LivePage,
    action,
    html,
    page,
    state,
} = require('../..');
const { escapeHtml, isHtml, renderValue } = require('../../src/htmx/Html');
const { PageManager } = require('../../src/htmx/PageManager');
const browserRuntime = require('../../src/htmx/browserRuntime');
const { getActionMetadata, getPageMetadata, getStateMetadata } = require('../../src/htmx/metadata');

function decorateAction(PageClass, name) {
    action()(PageClass.prototype, name, Object.getOwnPropertyDescriptor(PageClass.prototype, name));
}

describe('decorator-first Live HTML units', () => {
    test('escapes values and composes explicitly trusted HTML fragments', () => {
        expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
        expect(escapeHtml(null)).toBe('');
        const strong = html`<strong>${'<Redweb>'}</strong>`;
        expect(isHtml(strong)).toBe(true);
        expect(isHtml(null)).toBe(false);
        expect(renderValue(strong)).toBe('<strong>&lt;Redweb&gt;</strong>');
        expect(renderValue('<b>unsafe</b>')).toBe('&lt;b&gt;unsafe&lt;/b&gt;');
        expect(html`<p>${strong}</p>`.toString()).toBe('<p><strong>&lt;Redweb&gt;</strong></p>');
        expect(() => html(['not', 'tagged'], 'value')).toThrow('tagged template');
    });

    test('validates and records page, state, and action decorator metadata', () => {
        expect(() => page('relative')).toThrow('beginning with');
        expect(() => page('/', null)).toThrow('options');
        expect(() => page('/', { template: '' })).toThrow('template');
        expect(() => page('/', { scope: 'request' })).toThrow('scope');
        expect(() => page('/')({})).toThrow('class');
        expect(() => state(null)).toThrow('options');
        expect(() => state({ writable: 'yes' })).toThrow('writable');
        expect(() => state()(null, 'name')).toThrow('class member');
        expect(() => state()({}, '')).toThrow('non-empty');
        expect(() => action()(null, 'run', { value() {} })).toThrow('class member');
        expect(() => action()({}, 'run', {})).toThrow('method');

        class MetadataPage extends LivePage {
            run() { return 'ok'; }
        }
        state({ writable: true })(MetadataPage.prototype, 'name');
        decorateAction(MetadataPage, 'run');
        page('/metadata', { template: 'page.htmx', scope: 'shared' })(MetadataPage);

        expect(getPageMetadata(MetadataPage)).toEqual({ path: '/metadata', template: 'page.htmx', scope: 'shared' });
        expect(getStateMetadata(MetadataPage).get('name')).toEqual({ writable: true });
        expect(getActionMetadata(MetadataPage)).toEqual(new Set(['run']));
        getStateMetadata(MetadataPage).clear();
        getActionMetadata(MetadataPage).clear();
        expect(getStateMetadata(MetadataPage).has('name')).toBe(true);
        expect(getActionMetadata(MetadataPage).has('run')).toBe(true);
    });

    test('publishes shallow state, allows explicit writes and actions, and cleans up idempotently', async () => {
        const lifecycle = [];
        class TestPage extends LivePage {
            connected(context) { lifecycle.push(['connected', context.signal]); }
            disconnected() { lifecycle.push(['disconnected']); }
            disposed() { lifecycle.push(['disposed']); }
            greet(value, context) { return `${value}:${context.socket.id}`; }
        }
        state()(TestPage.prototype, 'count');
        state({ writable: true })(TestPage.prototype, 'name');
        decorateAction(TestPage, 'greet');
        const sent = [];
        const socket = { id: 'socket', sendEvent: (type, payload) => sent.push([type, payload]) };
        const instance = new TestPage();
        expect(instance._stateChanged('other', 1)).toBe(false);
        instance.count = 1;
        expect(sent).toEqual([]);
        await instance._attach(socket, { signal: 'signal' });
        instance.count = 2;
        instance.count = 2;
        expect(sent).toEqual([['redweb:state', { name: 'count', value: '2', html: false }]]);
        instance._setFromClient('name', 'Ada');
        expect(instance.name).toBe('Ada');
        expect(() => instance._setFromClient('count', 3)).toThrow('not browser-writable');
        await expect(instance._invoke('greet', ['hello'], { socket })).resolves.toBe('hello:socket');
        await expect(instance._invoke('missing', [], { socket })).rejects.toThrow('Unknown page action');
        await expect(instance._invoke('greet', null, { socket })).rejects.toThrow('array');
        expect(instance._detach(socket, {})).toBe(true);
        expect(instance._detach(socket, {})).toBe(false);
        expect(instance.dispose()).toBe(true);
        expect(instance.dispose()).toBe(false);
        expect(() => instance._attach(socket, {})).toThrow('disposed');
        expect(lifecycle).toEqual([['connected', 'signal'], ['disconnected'], ['disposed']]);
    });

    test('loads declarative templates safely and renders text, HTML, state patches, and documents', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-live-unit-'));
        try {
            fs.writeFileSync(path.join(root, 'page.htmx'), '<h1>{{ title }}</h1>');
            expect(HtmxRenderer.template('page.htmx', root)).toBe('<h1>{{ title }}</h1>');
            expect(() => HtmxRenderer.template('../outside.htmx', root)).toThrow('outside');
            expect(() => HtmxRenderer.template('missing.htmx', root)).toThrow('not found');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }

        const pageState = { title: '<unsafe>', body: html`<b>${'safe'}</b>` };
        expect(HtmxRenderer.render('{{title}} {{ body }}', pageState)).toBe(
            '<span data-rw-state="title">&lt;unsafe&gt;</span> ' +
            '<span data-rw-state="body" data-rw-html><b>safe</b></span>'
        );
        expect(() => HtmxRenderer.render(null, pageState)).toThrow('string');
        expect(() => HtmxRenderer.render('{{missing}}', pageState)).toThrow('Unknown page binding');
        expect(HtmxRenderer.statePayload('empty', null)).toEqual({ name: 'empty', value: '', html: false });
        expect(HtmxRenderer.statePayload('body', pageState.body)).toEqual({ name: 'body', value: '<b>safe</b>', html: true });

        const config = { pageId: '<id>', socketPath: '/live', runtimePath: '/runtime.js', version: '1' };
        const fragment = HtmxRenderer.document('<p>hello</p>', config);
        expect(fragment).toContain('<main data-rw-root><p>hello</p></main>');
        expect(fragment).toContain('"pageId":"\\u003cid>"');
        const document = HtmxRenderer.document('<html><body>hello</body></html>', config);
        expect(document).toContain('hello<script type="application/json"');
        expect(document.match(/<body>/g)).toHaveLength(1);
    });

    test('generates a small delegated browser runtime around redweb-client', () => {
        const source = browserRuntime('/internal/client.js');
        expect(source).toContain("from \"/internal/client.js\"");
        expect(source).toContain("client.send('redweb:html'");
        expect(source).toContain("document.addEventListener('click'");
        expect(source).toContain("document.addEventListener('submit'");
        expect(source).toContain("document.addEventListener('input'");
    });

    test('runs the legacy TypeScript decorator ABI used by the public examples', async () => {
        const fixture = path.join(__dirname, '..', 'fixtures', 'live-html-decorators.ts');
        const output = ts.transpileModule(fs.readFileSync(fixture, 'utf8'), {
            compilerOptions: {
                experimentalDecorators: true,
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2020,
            },
        }).outputText;
        const compiled = new Module(fixture, module);
        compiled.filename = fixture.replace(/\.ts$/, '.js');
        compiled.paths = Module._nodeModulePaths(path.dirname(fixture));
        compiled._compile(output, compiled.filename);
        const instance = new compiled.exports.CompiledPage();
        expect(instance.greet().toString()).toBe('<h1>Hello Redweb</h1>');
        instance._setFromClient('name', 'Ada');
        expect(await instance._invoke('greet', [], { socket: {} }).then(value => value.toString())).toBe('<h1>Hello Ada</h1>');
        const server = compiled.exports.createCompiledServer();
        expect(server.manager.records.has('/compiled')).toBe(true);
        await server.shutdown();
    });

    test('validates page manager configuration and page registration', () => {
        class PlainPage extends LivePage { render() { return 'ok'; } }
        page('/plain')(PlainPage);
        expect(() => new PageManager({ pages: [] })).toThrow('non-empty');
        expect(() => new PageManager({ pages: [PlainPage], templateRoot: '' })).toThrow('templateRoot');
        expect(() => new PageManager({ pages: [PlainPage], sessionTtlMs: -1 })).toThrow('sessionTtlMs');
        expect(() => new PageManager({ pages: [PlainPage], maxSessions: 0 })).toThrow('maxSessions');
        expect(() => new PageManager({ pages: [PlainPage], paths: null })).toThrow('paths');
        expect(() => new PageManager({ pages: [PlainPage], paths: { socket: 'relative' } })).toThrow('begin');
        expect(() => new PageManager({ pages: [PlainPage], paths: { socket: '/same', client: '/same' } })).toThrow('unique');
        expect(() => new PageManager({ pages: [class {}] })).toThrow('extend LivePage');
        expect(() => new PageManager({ pages: [class extends LivePage {}] })).toThrow('missing @page');

        class DuplicatePage extends LivePage {}
        page('/plain')(DuplicatePage);
        expect(() => new PageManager({ pages: [PlainPage, DuplicatePage] })).toThrow('Duplicate');
        class ReservedPage extends LivePage {}
        page('/__redweb/live')(ReservedPage);
        expect(() => new PageManager({ pages: [ReservedPage] })).toThrow('reserved');
        expect(getStateMetadata(class {})).toEqual(new Map());
        expect(getActionMetadata(class {})).toEqual(new Set());
    });

    test('covers manager rendering, admission, messaging, expiry, and lifecycle failures', async () => {
        class ManagedPage extends LivePage {
            async loading(context) { this.loaded = context.query.loaded; }
            render() { return html`<h1>{{ loaded }}</h1>`; }
            echo(value) { return value; }
            noop() {}
        }
        state({ writable: true })(ManagedPage.prototype, 'name');
        decorateAction(ManagedPage, 'echo');
        decorateAction(ManagedPage, 'noop');
        page('/managed')(ManagedPage);
        const manager = new PageManager({ pages: [ManagedPage], maxSessions: 1, sessionTtlMs: 10, logger: null });
        manager.logger.log();
        manager.logger.warn();
        manager.logger.error();
        const record = manager.records.get('/managed');
        const request = { params: {}, query: { loaded: 'yes' }, body: null };
        const rendered = await manager.render(record, request);
        expect(rendered).toContain('<h1><span data-rw-state="loaded">yes</span></h1>');
        await expect(manager.render(record, request)).rejects.toMatchObject({ status: 503 });

        const pending = [...manager.pending.values()][0];
        expect(manager.authenticate({ url: '[', headers: { host: '[' } })).toBe(false);
        expect(manager.authenticate({ url: '/', headers: {} })).toBe(false);
        expect(manager.authenticate({ url: `/?pageId=${'x'.repeat(129)}`, headers: {} })).toBe(false);
        expect(manager.authenticate({ url: `/?pageId=${pending.id}`, headers: {} })).toBe(pending);
        expect(manager.acceptsOrigin(undefined, { headers: {} })).toBe(false);
        expect(manager.acceptsOrigin('not a url', { headers: {} })).toBe(false);
        expect(manager.acceptsOrigin('ftp://example.com', { headers: { host: 'example.com' } })).toBe(false);
        expect(manager.acceptsOrigin('http://other.example', { headers: { host: 'example.com' } })).toBe(false);
        expect(manager.acceptsOrigin('https://example.com', { headers: { host: 'example.com' } })).toBe(true);
        expect(() => manager.connect(null, {})).toThrow('unavailable');

        const sent = [];
        const socket = {
            context: {},
            sendEvent: (type, payload, metadata) => sent.push([type, payload, metadata]),
        };
        await manager.connect(pending, socket);
        expect(() => manager.connect(pending, {})).toThrow('unavailable');
        expect(manager.authenticate({ url: `/?pageId=${pending.id}`, headers: {} })).toBe(false);
        await expect(manager.receive({}, { payload: {} })).rejects.toThrow('not connected');
        await expect(manager.receive(socket, { payload: null })).rejects.toThrow('payload');
        for (const name of ['', 'x'.repeat(129), '__proto__']) {
            await expect(manager.receive(socket, { payload: { kind: 'action', name, args: [] } })).rejects.toThrow('safe');
        }
        await manager.receive(socket, { payload: { kind: 'state', name: 'name', value: 'Ada' } });
        expect(pending.page.name).toBe('Ada');
        await manager.receive(socket, {
            payload: { kind: 'action', name: 'echo', args: ['hello'] },
            requestId: 'request',
        });
        expect(sent.at(-1)).toEqual(['redweb:result', 'hello', { requestId: 'request' }]);
        await manager.receive(socket, {
            payload: { kind: 'action', name: 'noop', args: [] },
            requestId: 'empty-result',
        });
        expect(sent.at(-1)).toEqual(['redweb:result', null, { requestId: 'empty-result' }]);
        const sentCount = sent.length;
        await manager.receive(socket, { payload: { kind: 'action', name: 'echo', args: ['unobserved'] } });
        expect(sent).toHaveLength(sentCount);
        await expect(manager.receive(socket, { payload: { kind: 'other', name: 'name' } })).rejects.toThrow('message kind');
        expect(manager.disconnect({})).toBe(false);
        expect(manager.disconnect(socket)).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(manager.active.size).toBe(0);
        expect(pending.page._disposed).toBe(true);
        manager.shutdown();

        let missingInstance;
        class MissingRender extends LivePage { constructor() { super(); missingInstance = this; } }
        page('/missing-render')(MissingRender);
        const missing = new PageManager({ pages: [MissingRender] });
        await expect(missing.render(missing.records.get('/missing-render'), request)).rejects.toThrow('template or render');
        expect(missingInstance._disposed).toBe(true);
        missing.shutdown();

        class SharedFailure extends LivePage { render() { throw new Error('shared render failed'); } }
        page('/shared-failure', { scope: 'shared' })(SharedFailure);
        const sharedFailure = new PageManager({ pages: [SharedFailure] });
        const sharedInstance = sharedFailure.records.get('/shared-failure').shared;
        await expect(sharedFailure.render(sharedFailure.records.get('/shared-failure'), request)).rejects.toThrow('shared render failed');
        expect(sharedInstance._disposed).toBe(false);
        sharedFailure.shutdown();
        expect(sharedInstance._disposed).toBe(true);

        class BadDisconnect extends LivePage { disconnected() { throw new Error('disconnect failed'); } }
        page('/bad-disconnect')(BadDisconnect);
        const disconnectManager = new PageManager({ pages: [BadDisconnect] });
        const disconnectSession = disconnectManager.createSession(new BadDisconnect(), true);
        const disconnectSocket = { context: {} };
        disconnectManager.connect(disconnectSession, disconnectSocket);
        expect(() => disconnectManager.disconnect(disconnectSocket)).toThrow('disconnect failed');
        expect(disconnectSession.socket).toBeNull();
        disconnectManager.shutdown();

        class BadConstruction extends LivePage { constructor() { return {}; } }
        page('/bad-construction')(BadConstruction);
        const bad = new PageManager({ pages: [BadConstruction] });
        await expect(bad.render(bad.records.get('/bad-construction'), request)).rejects.toThrow('construction');
        bad.shutdown();
    });

    test('validates and composes LiveHtmlServer with an existing app and idempotent shutdown', async () => {
        const LiveHtmlServer = require('../../src/htmx/LiveHtmlServer');
        expect(() => new LiveHtmlServer()).toThrow('pages');
        expect(() => new LiveHtmlServer(null)).toThrow('options');
        expect(() => new LiveHtmlServer([])).toThrow('options');
        class Page extends LivePage { render() { return 'ok'; } }
        page('/')(Page);
        expect(() => new LiveHtmlServer({ pages: [Page], server: {} })).toThrow('Express-compatible');
        const server = new LiveHtmlServer({ pages: [Page], server: express(), listen: false });
        expect(server.app).toBeDefined();
        const first = server.shutdown();
        const second = server.shutdown();
        expect(second).toBe(first);
        await first;
    });
});
