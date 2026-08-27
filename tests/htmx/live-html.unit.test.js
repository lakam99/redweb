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
        expect(() => html`<a href="${'javascript:alert(1)'}">link</a>`).toThrow('element text');
        expect(() => html`<script>${'</script><b>unsafe</b>'}</script>`).toThrow('script or style');
        expect(() => html`<script>safe()</script><style>${'unsafe'}</style>`).toThrow('script or style');
    });

    test('validates and records page, state, and action decorator metadata', async () => {
        expect(() => page('relative')).toThrow('beginning with');
        expect(() => page('/', null)).toThrow('options');
        expect(() => page('/', { template: '' })).toThrow('template');
        expect(() => page('/', { scope: 'request' })).toThrow('scope');
        expect(() => page('/')({})).toThrow('class');
        expect(() => state(null)).toThrow('options');
        expect(() => state({ writable: 'yes' })).toThrow('writable');
        expect(() => state()(null, 'name')).toThrow('class member');
        expect(() => state()({}, '')).toThrow('non-empty');
        expect(() => state()(undefined, { kind: 'field', static: true, name: 'value' })).toThrow('public instance field');
        expect(() => action()(null, 'run', { value() {} })).toThrow('class member');
        expect(() => action()({}, 'run', {})).toThrow('method');
        expect(() => action()(() => {}, { kind: 'method', private: true, name: 'run' })).toThrow('public instance method');

        class MetadataPage extends LivePage {
            run() { return 'ok'; }
        }
        state({ writable: true })(MetadataPage.prototype, 'name');
        decorateAction(MetadataPage, 'run');
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

        class BaseMetadataPage extends LivePage { ping() { return 'base'; } }
        state()(BaseMetadataPage.prototype, 'count');
        decorateAction(BaseMetadataPage, 'ping');
        class InheritedMetadataPage extends BaseMetadataPage {}
        const inherited = new InheritedMetadataPage();
        inherited.count = 0;
        inherited._activateState();
        const inheritedUpdates = [];
        await inherited._attach({ sendEvent: (type, payload) => inheritedUpdates.push([type, payload]) }, {});
        inheritedUpdates.length = 0;
        inherited.count = 1;
        expect(inheritedUpdates).toEqual([['redweb:state', { name: 'count', value: '1', html: false }]]);
        await expect(inherited._invoke('ping', [], {})).resolves.toBe('base');
        class HiddenActionPage extends BaseMetadataPage { ping() { return 'hidden'; } }
        const hidden = new HiddenActionPage();
        await expect(hidden._invoke('ping', [], {})).rejects.toThrow('Unknown page action');

        let stateInitializer;
        class StandardMetadataPage extends LivePage { run() { return 'standard'; } }
        const stateIdentity = state({ writable: true })(undefined, {
            kind: 'field', static: false, private: false, name: 'value',
            addInitializer: initializer => { stateInitializer = initializer; },
        });
        const actionValue = action()(StandardMetadataPage.prototype.run, {
            kind: 'method', static: false, private: false, name: 'run',
            addInitializer: initializer => initializer.call(new StandardMetadataPage()),
        });
        action()(StandardMetadataPage.prototype.run, {
            kind: 'method', static: false, private: false, name: 'run', addInitializer() {},
        });
        stateInitializer.call(new StandardMetadataPage());
        expect(stateIdentity('initial')).toBe('initial');
        expect(actionValue).toBe(StandardMetadataPage.prototype.run);
        expect(getStateMetadata(StandardMetadataPage).get('value')).toEqual({ writable: true });
        expect(getActionMetadata(StandardMetadataPage).has('run')).toBe(true);
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
        expect(instance._activateState()).toBe(true);
        expect(instance._activateState()).toBe(false);
        expect(instance._stateChanged('other', 1)).toBe(false);
        instance.count = 1;
        expect(sent).toEqual([]);
        await instance._attach(socket, { signal: 'signal' });
        expect(sent).toEqual([
            ['redweb:state', { name: 'count', value: '1', html: false }],
            ['redweb:state', { name: 'name', value: '', html: false }],
        ]);
        sent.length = 0;
        instance.count = 2;
        instance.count = 2;
        expect(sent).toEqual([['redweb:state', { name: 'count', value: '2', html: false }]]);
        instance._setFromClient('name', 'Ada');
        expect(instance.name).toBe('Ada');
        expect(() => instance._setFromClient('count', 3)).toThrow('not browser-writable');
        await expect(instance._invoke('greet', ['hello'], { socket })).resolves.toBe('hello:socket');
        await expect(instance._invoke('missing', [], { socket })).rejects.toThrow('Unknown page action');
        await expect(instance._invoke('greet', null, { socket })).rejects.toThrow('array');
        await expect(instance._detach(socket, {})).resolves.toBe(true);
        await expect(instance._detach(socket, {})).resolves.toBe(false);
        await expect(instance.dispose()).resolves.toBe(true);
        await expect(instance.dispose()).resolves.toBe(true);
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
        expect(HtmxRenderer.render('<ul data-rw-state="body"></ul>', pageState)).toBe(
            '<ul data-rw-state="body" data-rw-html><b>safe</b></ul>'
        );
        expect(HtmxRenderer.render('<ul data-rw-state="body" data-rw-html></ul>', pageState)).toContain('<b>safe</b>');
        expect(() => HtmxRenderer.render('<p data-rw-state="missing"></p>', pageState)).toThrow('Unknown page binding');
        expect(() => HtmxRenderer.render(null, pageState)).toThrow('string');
        expect(() => HtmxRenderer.render('{{missing}}', pageState)).toThrow('Unknown page binding');
        expect(() => HtmxRenderer.render('<a href="{{ title }}">link</a>', pageState)).toThrow('element text');
        expect(() => HtmxRenderer.render('<script>{{ title }}</script>', pageState)).toThrow('script or style');
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

    test.each([
        ['legacy', true],
        ['standard', false],
    ])('runs the %s TypeScript decorator ABI used by the public examples', async (_label, experimentalDecorators) => {
        const fixture = path.join(__dirname, '..', 'fixtures', 'live-html-decorators.ts');
        const output = ts.transpileModule(fs.readFileSync(fixture, 'utf8'), {
            compilerOptions: {
                experimentalDecorators,
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
                useDefineForClassFields: true,
            },
        }).outputText;
        const compiled = new Module(fixture, module);
        compiled.filename = fixture.replace(/\.ts$/, '.js');
        compiled.paths = Module._nodeModulePaths(path.dirname(fixture));
        compiled._compile(output, compiled.filename);
        const instance = new compiled.exports.CompiledPage();
        instance._activateState();
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
        expect(() => new PageManager({ pages: [PlainPage], authenticate: true })).toThrow('authenticate');
        expect(() => new PageManager({ pages: [PlainPage], origins: [null] })).toThrow('origins');
        expect(() => new PageManager({ pages: [PlainPage], paths: { socket: 'relative' } })).toThrow('absolute');
        expect(() => new PageManager({ pages: [PlainPage], paths: { socket: '/live?unsafe="' } })).toThrow('safe');
        expect(() => new PageManager({ pages: [PlainPage], paths: { runtime: '//evil.example/runtime.js' } })).toThrow('safe');
        expect(() => new PageManager({ pages: [PlainPage], paths: { runtime: '/safe//unsafe.js' } })).toThrow('safe');
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
        await expect(manager.authenticate({ url: '[', headers: { host: '[' } })).resolves.toBe(false);
        await expect(manager.authenticate({ url: '/', headers: {} })).resolves.toBe(false);
        await expect(manager.authenticate({ url: `/?pageId=${'x'.repeat(129)}`, headers: {} })).resolves.toBe(false);
        await expect(manager.authenticate({ url: `/?pageId=${pending.id}`, headers: {} })).resolves.toBe(pending);
        expect(manager.acceptsOrigin(undefined, { headers: {} })).toBe(false);
        expect(manager.acceptsOrigin('not a url', { headers: {} })).toBe(false);
        expect(manager.acceptsOrigin('ftp://example.com', { headers: { host: 'example.com' } })).toBe(false);
        expect(manager.acceptsOrigin('http://other.example', { headers: { host: 'example.com' } })).toBe(false);
        expect(manager.acceptsOrigin('https://example.com', { headers: { host: 'example.com' } })).toBe(false);
        expect(manager.acceptsOrigin('http://example.com', { headers: { host: 'example.com' } })).toBe(true);
        expect(manager.acceptsOrigin('https://example.com', { headers: { host: 'example.com' }, socket: { encrypted: true } })).toBe(true);
        const listedOrigins = new PageManager({ pages: [ManagedPage], origins: ['https://proxy.example'] });
        expect(listedOrigins.acceptsOrigin('https://proxy.example', { headers: {} })).toBe(true);
        await listedOrigins.shutdown();
        const dynamicOrigins = new PageManager({ pages: [ManagedPage], origins: origin => origin === 'https://dynamic.example' });
        expect(dynamicOrigins.acceptsOrigin('https://dynamic.example', { headers: {} })).toBe(true);
        await dynamicOrigins.shutdown();
        expect(() => manager.connect(null, {})).toThrow('unavailable');

        const sent = [];
        const socket = {
            context: {},
            sendEvent: (type, payload, metadata) => sent.push([type, payload, metadata]),
        };
        await manager.connect(pending, socket);
        expect(() => manager.connect(pending, {})).toThrow('unavailable');
        await expect(manager.authenticate({ url: `/?pageId=${pending.id}`, headers: {} })).resolves.toBe(false);
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
        await expect(manager.disconnect({})).resolves.toBe(false);
        await expect(manager.disconnect(socket)).resolves.toBe(true);
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(manager.active.size).toBe(0);
        expect(pending.page._disposed).toBe(true);
        await manager.shutdown();

        let missingInstance;
        class MissingRender extends LivePage { constructor() { super(); missingInstance = this; } }
        page('/missing-render')(MissingRender);
        const missing = new PageManager({ pages: [MissingRender] });
        await expect(missing.render(missing.records.get('/missing-render'), request)).rejects.toThrow('template or render');
        expect(missingInstance._disposed).toBe(true);
        await missing.shutdown();

        class SharedFailure extends LivePage { render() { throw new Error('shared render failed'); } }
        page('/shared-failure', { scope: 'shared' })(SharedFailure);
        const sharedFailure = new PageManager({ pages: [SharedFailure] });
        const sharedInstance = sharedFailure.records.get('/shared-failure').shared;
        await expect(sharedFailure.render(sharedFailure.records.get('/shared-failure'), request)).rejects.toThrow('shared render failed');
        expect(sharedInstance._disposed).toBe(false);
        await sharedFailure.shutdown();
        expect(sharedInstance._disposed).toBe(true);

        class BadDisconnect extends LivePage { disconnected() { throw new Error('disconnect failed'); } }
        page('/bad-disconnect')(BadDisconnect);
        const disconnectManager = new PageManager({ pages: [BadDisconnect] });
        const disconnectSession = disconnectManager.createSession(new BadDisconnect(), true);
        const disconnectSocket = { context: {} };
        disconnectSession.page._activateState();
        await disconnectManager.connect(disconnectSession, disconnectSocket);
        await expect(disconnectManager.disconnect(disconnectSocket)).rejects.toThrow('disconnect failed');
        expect(disconnectSession.socket).toBeNull();
        await disconnectManager.shutdown();

        class BadConstruction extends LivePage { constructor() { return {}; } }
        page('/bad-construction')(BadConstruction);
        const bad = new PageManager({ pages: [BadConstruction] });
        await expect(bad.render(bad.records.get('/bad-construction'), request)).rejects.toThrow('construction');
        await bad.shutdown();

        const authenticated = new PageManager({
            pages: [ManagedPage],
            authenticate: requestValue => requestValue.headers?.authorization,
        });
        const authenticatedRecord = authenticated.records.get('/managed');
        await expect(authenticated.render(authenticatedRecord, { ...request, headers: {} })).rejects.toMatchObject({ status: 401 });
        await expect(authenticated.render(authenticatedRecord, {
            ...request,
            headers: { authorization: {} },
        })).rejects.toMatchObject({ status: 401 });
        const authenticatedMarkup = await authenticated.render(authenticatedRecord, {
            ...request,
            headers: { authorization: 'user-1' },
        });
        const authenticatedId = JSON.parse(authenticatedMarkup.match(/id="__redweb_page">([^<]+)/)[1]).pageId;
        await expect(authenticated.authenticate({
            url: `/?pageId=${authenticatedId}`,
            headers: { authorization: 'user-2' },
        })).resolves.toBe(false);
        await expect(authenticated.authenticate({
            url: `/?pageId=${authenticatedId}`,
            headers: { authorization: 'user-1' },
        })).resolves.toMatchObject({ principal: 'user-1' });
        await authenticated.shutdown();

        const cleanupErrors = [];
        class FailingExpiry extends LivePage {
            disposed() { throw new Error('expected cleanup failure'); }
        }
        page('/failing-expiry')(FailingExpiry);
        const failingExpiry = new PageManager({
            pages: [FailingExpiry],
            sessionTtlMs: 1,
            logger: { error: (...args) => cleanupErrors.push(args) },
        });
        const expiringPage = failingExpiry.instantiate(failingExpiry.records.get('/failing-expiry'));
        const expiringSession = failingExpiry.createSession(expiringPage, true);
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(cleanupErrors[0][0]).toBe('Live HTML session cleanup failed.');
        expiringSession.page._disposePromise.catch(() => {});
        await failingExpiry.shutdown();

        const disposedManager = new PageManager({ pages: [ManagedPage] });
        const disposedPage = disposedManager.instantiate(disposedManager.records.get('/managed'));
        const disposedSession = disposedManager.createSession(disposedPage, true);
        await disposedPage.dispose();
        await expect(disposedManager.authenticate({
            url: `/?pageId=${disposedSession.id}`,
            headers: {},
        })).resolves.toBe(false);
        await disposedManager.shutdown();

        let releaseSlowRender;
        class SlowRender extends LivePage {
            loading() { return new Promise(resolve => { releaseSlowRender = resolve; }); }
            render() { return '<p>slow</p>'; }
        }
        page('/slow-render')(SlowRender);
        const slowManager = new PageManager({ pages: [SlowRender], maxSessions: 1 });
        const slowRecord = slowManager.records.get('/slow-render');
        const slowRender = slowManager.render(slowRecord, request);
        await new Promise(resolve => setImmediate(resolve));
        await expect(slowManager.render(slowRecord, request)).rejects.toMatchObject({ status: 503 });
        const slowShutdown = slowManager.shutdown();
        await expect(slowManager.render(slowRecord, request)).rejects.toMatchObject({ status: 503 });
        releaseSlowRender();
        await slowRender;
        await slowShutdown;
        expect(slowManager.rendering).toBe(0);
        expect(slowManager.pending.size).toBe(0);

        const parallelReleases = [];
        class ParallelRender extends LivePage {
            loading() { return new Promise(resolve => parallelReleases.push(resolve)); }
            render() { return '<p>parallel</p>'; }
        }
        page('/parallel-render')(ParallelRender);
        const parallelManager = new PageManager({ pages: [ParallelRender], maxSessions: 2 });
        const parallelRecord = parallelManager.records.get('/parallel-render');
        const parallelFirst = parallelManager.render(parallelRecord, request);
        const parallelSecond = parallelManager.render(parallelRecord, request);
        await new Promise(resolve => setImmediate(resolve));
        parallelReleases[0]();
        await parallelFirst;
        expect(parallelManager.rendering).toBe(1);
        parallelReleases[1]();
        await parallelSecond;
        await parallelManager.shutdown();
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
