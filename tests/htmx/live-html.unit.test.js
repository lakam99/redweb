const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const Module = require('module');
const ts = require('typescript');
const { pathToFileURL } = require('url');
const {
    HtmlRenderer,
    LivePage,
    action,
    attribute,
    codeBlock,
    each,
    exportStatic,
    html,
    page,
    start,
    state,
    url,
    view,
} = require('../..');
const { escapeHtml, isHtml, renderValue } = require('../../src/htmx/Html');
const { PageManager } = require('../../src/htmx/PageManager');
const PageAssetLoader = require('../../src/htmx/PageAssetLoader');
const browserRuntime = require('../../src/htmx/browserRuntime');
const { getActionMetadata, getPageMetadata, getStateMetadata, getViewImplementation } = require('../../src/htmx/metadata');
const { callerDirectory, filePath } = require('../../src/htmx/sourceRoot');

function decorateAction(PageClass, name) {
    action()(PageClass.prototype, name, Object.getOwnPropertyDescriptor(PageClass.prototype, name));
}

function decorateView(PageClass, stateName, name) {
    view(stateName)(PageClass.prototype, name, Object.getOwnPropertyDescriptor(PageClass.prototype, name));
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
        expect(renderValue([html`<i>${'one'}</i>`, html`<i>${'two'}</i>`])).toBe('<i>one</i><i>two</i>');
        expect(isHtml([html`<i>one</i>`, [html`<i>two</i>`]])).toBe(true);
        expect(isHtml([])).toBe(true);
        expect(() => renderValue([html`<i>safe</i>`, '<b>unsafe</b>'])).toThrow('arrays of HtmlFragment');
        expect(html`${[html`<i>one</i>`, html`<i>two</i>`]}`.toString()).toBe('<i>one</i><i>two</i>');
        expect(html`<p>${strong}</p>`.toString()).toBe('<p><strong>&lt;Redweb&gt;</strong></p>');
        expect(html`<article id="${attribute('api<one')}" data-index='${attribute(1)}'>safe</article>`.toString())
            .toBe('<article id="api&lt;one" data-index=\'1\'>safe</article>');
        expect(html`<article title="1 > 0" id="${attribute('angles')}">safe</article>`.toString())
            .toContain('id="angles"');
        expect(html`<article title="1 < 2" id="${attribute('less')}">safe</article>`.toString())
            .toContain('id="less"');
        expect(html`<a href="${url('#api')}" cite='${url('https://example.test/docs')}'>docs</a>`.toString())
            .toContain('href="#api" cite=\'https://example.test/docs\'');
        expect(html`<a href="${url('mailto:docs@example.test')}">mail</a>`.toString()).toContain('mailto:');
        expect(html`<a href="${url('tel:+15551234')}">call</a>`.toString()).toContain('tel:');
        expect(html`<a href="${url('/docs?tab=api')}">relative</a>`.toString()).toContain('/docs?tab=api');
        expect(() => attribute({})).toThrow('string, number');
        expect(() => url('')).toThrow('non-empty URL');
        expect(() => url(' /docs')).toThrow('surrounding whitespace');
        expect(() => url('/docs\n')).toThrow('surrounding whitespace');
        expect(() => url('//foreign.example/docs')).toThrow('protocol-relative');
        expect(() => url('\\foreign.example\\docs')).toThrow('backslash');
        expect(() => url('javascript:alert(1)')).toThrow('javascript:');
        expect(() => html`<a href="${attribute('unsafe')}">link</a>`).toThrow('requires url');
        expect(() => html`<p id="${url('#wrong')}">wrong</p>`).toThrow('requires attribute');
        expect(() => html`<button onclick="${attribute('run()')}">wrong</button>`).toThrow('not allowed');
        expect(() => html`<p style="${attribute('color:red')}">wrong</p>`).toThrow('not allowed');
        expect(() => html`<iframe srcdoc="${attribute('<p>wrong</p>')}"></iframe>`).toThrow('not allowed');
        expect(() => html`<img srcset="${attribute('one.png 1x')}">`).toThrow('not allowed');
        expect(() => html`<object data="${attribute('/file')}"></object>`).toThrow('requires url');
        expect(() => html`<p>${attribute('wrong')}</p>`).toThrow('matching quoted attributes');
        expect(() => html`<div ${'unfinished'}`).toThrow('element text');
        expect(() => html`</${'closing'}>`).toThrow('element text');
        expect(each(['one', 'two'], (item, index) => html`<i>${index}:${item}</i>`).toString())
            .toBe('<i>0:one</i><i>1:two</i>');
        expect(each([], item => html`${item}`).toString()).toBe('');
        expect(() => each(null, () => html``)).toThrow('array');
        expect(() => each([], null)).toThrow('render function');
        expect(() => each(['unsafe'], item => item)).toThrow('html fragments');
        expect(codeBlock('<script>', { language: 'ts', label: 'TypeScript' }).toString())
            .toContain('<figcaption>TypeScript</figcaption><pre><code class="language-ts">&lt;script&gt;</code>');
        expect(codeBlock(html`<span class="token">const</span>`, { language: 'js' }).toString())
            .toContain('<code class="language-js"><span class="token">const</span></code>');
        expect(codeBlock(null, { label: '' }).toString()).not.toContain('figcaption');
        expect(codeBlock('plain').toString()).toContain('language-text');
        expect(() => codeBlock('x', null)).toThrow('options');
        expect(() => codeBlock('x', { language: 'not valid' })).toThrow('safe name');
        expect(() => codeBlock('x', { label: null })).toThrow('label');
        expect(() => html(['not', 'tagged'], 'value')).toThrow('tagged template');
        expect(() => html`<a href="${'javascript:alert(1)'}">link</a>`).toThrow('requires url');
        expect(() => html`<a title="> ${html`<b>unsafe</b>`}">link</a>`).toThrow('requires attribute');
        expect(() => html`<script>${'</script><b>unsafe</b>'}</script>`).toThrow('element text');
        expect(() => html`<script>safe()</script><style>${'unsafe'}</style>`).toThrow('element text');
        expect(() => html`<textarea>${'unsafe'}</textarea>`).toThrow('element text');
        expect(() => html`<title>${'unsafe'}</title>`).toThrow('element text');
        expect(() => html`<noscript>${'unsafe'}</noscript>`).toThrow('element text');
        expect(() => html`<!-- unfinished ${'unsafe'}`).toThrow('element text');
        expect(html`<!-- finished -->${'safe'}`.toString()).toBe('<!-- finished -->safe');
        expect(() => html`<plaintext>${'unsafe'}`).toThrow('element text');
        expect(html`<p>1 < 2 ${'safe'}</p>`.toString()).toBe('<p>1 < 2 safe</p>');
    });

    test('validates and records page, state, and action decorator metadata', async () => {
        expect(() => page('relative')).toThrow('beginning with');
        expect(() => page('/', null)).toThrow('options');
        expect(() => page('/', { template: '' })).toThrow('template');
        expect(() => page('/', { css: '' })).toThrow('css');
        expect(() => page('/', { css: [] })).toThrow('css');
        expect(() => page('/', { css: ['valid.css', null] })).toThrow('css');
        expect(() => page('/', { shared: 'yes' })).toThrow('boolean');
        expect(() => page('/', { scope: 'shared', shared: false })).toThrow('conflict');
        expect(() => page('/', { scope: 'request' })).toThrow('scope');
        expect(() => page('/', { live: 'no' })).toThrow('live');
        expect(() => page('/', { head: null })).toThrow('head');
        expect(() => page('/', { head: { unknown: true } })).toThrow('Unknown page head');
        expect(() => page('/', { head: { title: '' } })).toThrow('head title');
        expect(() => page('/', { head: { description: 1 } })).toThrow('head description');
        expect(() => page('/', { head: { robots: '' } })).toThrow('head robots');
        expect(() => page('/', { head: { canonical: '/docs' } })).toThrow('absolute HTTP');
        expect(() => page('/', { head: { canonical: 1 } })).toThrow('absolute HTTP');
        expect(() => page('/', { head: { image: 'ftp://example.test/image.png' } })).toThrow('absolute HTTP');
        expect(() => page('/', { head: { image: 'not a url' } })).toThrow('absolute HTTP');
        expect(() => page('/', { cache: {} })).toThrow('only when live is false');
        expect(() => page('/', { live: false, cache: null })).toThrow('cache');
        expect(() => page('/', { live: false, cache: { unknown: true } })).toThrow('Unknown page cache');
        expect(() => page('/', { live: false, cache: { maxAge: -1 } })).toThrow('maxAge');
        expect(() => page('/', { live: false, cache: { staleWhileRevalidate: 1.5 } })).toThrow('staleWhileRevalidate');
        expect(() => page('/', { live: false, cache: { immutable: 'yes' } })).toThrow('immutable');
        expect(() => page('/')({})).toThrow('class');
        expect(() => state(null)).toThrow('options');
        expect(() => state({ writable: 'yes' })).toThrow('writable');
        expect(() => state()(null, 'name')).toThrow('class member');
        expect(() => state()({}, '')).toThrow('non-empty');
        expect(() => state()(undefined, { kind: 'field', static: true, name: 'value' })).toThrow('public instance field');
        expect(() => action()(null, 'run', { value() {} })).toThrow('class member');
        expect(() => action()({}, 'run', {})).toThrow('method');
        expect(() => action()(() => {}, { kind: 'method', private: true, name: 'run' })).toThrow('public instance method');
        expect(() => view('')).toThrow('state name');
        expect(() => view('items')(null, 'item', { value() {} })).toThrow('class member');
        expect(() => view('items')({}, 'item', {})).toThrow('method');
        expect(() => view('items')(() => {}, { kind: 'method', private: true, name: 'item' })).toThrow('public instance method');

        class MetadataPage extends LivePage {
            run() { return 'ok'; }
        }
        state({ writable: true })(MetadataPage.prototype, 'name');
        decorateAction(MetadataPage, 'run');
        state({ writable: true })(MetadataPage.prototype, 'name');
        decorateAction(MetadataPage, 'run');
        page('/metadata', { template: 'page.html', css: ['page.css', 'page.css'], scope: 'shared' })(MetadataPage);

        expect(getPageMetadata(MetadataPage)).toEqual({
            path: '/metadata', template: 'page.html', css: ['page.css'], scope: 'shared',
        });
        expect(Object.isFrozen(getPageMetadata(MetadataPage).css)).toBe(true);
        class StaticMetadataPage {}
        page('/static', {
            live: false,
            head: {
                title: 'Docs',
                description: 'Reference',
                canonical: 'https://example.test/docs',
                image: 'https://example.test/image.png',
                robots: 'index,follow',
            },
            cache: { maxAge: 60, staleWhileRevalidate: 30, immutable: true },
        })(StaticMetadataPage);
        expect(getPageMetadata(StaticMetadataPage)).toMatchObject({
            live: false,
            head: {
                title: 'Docs',
                description: 'Reference',
                canonical: 'https://example.test/docs',
                image: 'https://example.test/image.png',
                robots: 'index,follow',
            },
            cache: { maxAge: 60, staleWhileRevalidate: 30, immutable: true },
        });
        expect(Object.isFrozen(getPageMetadata(StaticMetadataPage).head)).toBe(true);
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
        let actionInitializer;
        const actionValue = action()(StandardMetadataPage.prototype.run, {
            kind: 'method', static: false, private: false, name: 'run',
            addInitializer: initializer => { actionInitializer = initializer; },
        });
        stateInitializer.call(new StandardMetadataPage());
        actionInitializer.call(new StandardMetadataPage());
        actionInitializer.call(new StandardMetadataPage());
        actionInitializer.call({ constructor: class WrongActionOwner {}, run() { return 'different'; } });
        expect(stateIdentity('initial')).toBe('initial');
        expect(actionValue).toBe(StandardMetadataPage.prototype.run);
        expect(getStateMetadata(StandardMetadataPage).get('value')).toEqual({ writable: true });
        expect(getActionMetadata(StandardMetadataPage).has('run')).toBe(true);
        class AliasedStandardAction extends LivePage {}
        AliasedStandardAction.prototype.run = StandardMetadataPage.prototype.run;
        AliasedStandardAction.prototype.secret = StandardMetadataPage.prototype.run;
        expect(getActionMetadata(AliasedStandardAction)).toEqual(new Set());
        await expect(new AliasedStandardAction()._invoke('run', [], {})).rejects.toThrow('Unknown page action');
        class ReplacedStandardAction extends LivePage {}
        ReplacedStandardAction.prototype.run = StandardMetadataPage.prototype.run;
        actionInitializer.call(new ReplacedStandardAction());
        ReplacedStandardAction.prototype.run = () => 'replacement';
        expect(getActionMetadata(ReplacedStandardAction)).toEqual(new Set());

        let viewInitializer;
        class StandardViewPage { item(value) { return html`<i>${value}</i>`; } }
        const viewValue = view('items')(StandardViewPage.prototype.item, {
            kind: 'method', static: false, private: false, name: 'item',
            addInitializer: initializer => { viewInitializer = initializer; },
        });
        const standardView = new StandardViewPage();
        viewInitializer.call(standardView);
        viewInitializer.call(standardView);
        viewInitializer.call({ constructor: class WrongViewOwner {}, item() {} });
        expect(viewValue).toBe(StandardViewPage.prototype.item);
        expect(getViewImplementation(StandardViewPage, 'items')).toBe(StandardViewPage.prototype.item);
        class InheritedViewPage extends StandardViewPage {}
        expect(getViewImplementation(InheritedViewPage, 'items')).toBe(StandardViewPage.prototype.item);
        class HiddenViewPage extends StandardViewPage { item() { return html`hidden`; } }
        expect(getViewImplementation(HiddenViewPage, 'items')).toBeUndefined();
        class ReplacedViewPage extends StandardViewPage {}
        ReplacedViewPage.prototype.item = StandardViewPage.prototype.item;
        viewInitializer.call(new ReplacedViewPage());
        ReplacedViewPage.prototype.item = () => html`replacement`;
        expect(getViewImplementation(ReplacedViewPage, 'items')).toBeUndefined();
        class DecoratedViewPage extends StandardViewPage { item() { return html`decorated`; } }
        decorateView(DecoratedViewPage, 'items', 'item');
        expect(getViewImplementation(DecoratedViewPage, 'items')).toBe(DecoratedViewPage.prototype.item);
    });

    test('publishes shallow state, allows explicit writes and actions, and cleans up idempotently', async () => {
        const lifecycle = [];
        expect(new LivePage()._connections).toBeInstanceOf(Set);
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
        const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-live-outside-'));
        try {
            fs.writeFileSync(path.join(root, 'page.html'), '<h1>{{ title }}</h1>');
            fs.writeFileSync(path.join(root, 'page.css'), 'h1 { color: cyan; }');
            fs.writeFileSync(path.join(outsideRoot, 'secret.css'), 'secret');
            fs.symlinkSync(outsideRoot, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
            expect(HtmlRenderer.template('page.html', root)).toBe('<h1>{{ title }}</h1>');
            expect(HtmlRenderer.stylesheet('page.css', root)).toBe('h1 { color: cyan; }');
            expect(() => HtmlRenderer.template('../outside.html', root)).toThrow('outside');
            expect(() => HtmlRenderer.template('missing.html', root)).toThrow('not found');
            expect(() => HtmlRenderer.stylesheet('../outside.css', root)).toThrow('outside');
            expect(() => HtmlRenderer.stylesheet('linked/secret.css', root)).toThrow('outside');
            expect(() => HtmlRenderer.stylesheet('missing.css', root)).toThrow('not found');
            const assets = new PageAssetLoader();
            expect(assets.load('page.css', root, 'stylesheet')).toBe(assets.load('page.css', root, 'stylesheet'));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
            fs.rmSync(outsideRoot, { recursive: true, force: true });
        }

        const pageState = { title: '<unsafe>', body: html`<b>${'safe {{ secret }}'}</b>`, secret: 'LEAK' };
        expect(HtmlRenderer.render('{{title}} {{ body }}', pageState)).toBe(
            '<span data-rw-state="title">&lt;unsafe&gt;</span> ' +
            '<span data-rw-state="body" data-rw-html><b>safe {{ secret }}</b></span>'
        );
        expect(HtmlRenderer.render('<ul data-rw-state="body"></ul>', pageState)).toBe(
            '<ul data-rw-state="body" data-rw-html><b>safe {{ secret }}</b></ul>'
        );
        expect(HtmlRenderer.render('<ul data-rw-state="body" data-rw-html></ul>', pageState))
            .toContain('<b>safe {{ secret }}</b>');
        expect(() => HtmlRenderer.render('<p data-rw-state="missing"></p>', pageState)).toThrow('Unknown page binding');
        expect(() => HtmlRenderer.render(null, pageState)).toThrow('string');
        expect(() => HtmlRenderer.render('{{missing}}', pageState)).toThrow('Unknown page binding');
        expect(() => HtmlRenderer.render('<a href="{{ title }}">link</a>', pageState)).toThrow('element text');
        expect(HtmlRenderer.render('<script>{{ title }}</script>', pageState)).toBe('<script>{{ title }}</script>');
        expect(HtmlRenderer.statePayload('empty', null)).toEqual({ name: 'empty', value: '', html: false });
        expect(HtmlRenderer.statePayload('body', pageState.body)).toEqual({
            name: 'body', value: '<b>safe {{ secret }}</b>', html: true,
        });
        const fragmentArray = [html`<i>one</i>`, html`<i>two</i>`];
        expect(HtmlRenderer.render('<div data-rw-state="items"></div>', { items: fragmentArray }))
            .toBe('<div data-rw-state="items" data-rw-html><i>one</i><i>two</i></div>');
        expect(HtmlRenderer.statePayload('items', fragmentArray)).toEqual({
            name: 'items', value: '<i>one</i><i>two</i>', html: true,
        });

        class CardsPage {
            cards = [{ title: '{{ secret }}' }, { title: 'Shield' }];
            secret = 'LEAK';
            card(card, index) { return html`<article>${index}: ${card.title}</article>`; }
        }
        state()(CardsPage.prototype, 'cards');
        decorateView(CardsPage, 'cards', 'card');
        decorateView(CardsPage, 'cards', 'card');
        const cards = new CardsPage();
        expect(HtmlRenderer.render('<section rw-each="cards"></section>', cards)).toBe(
            '<section rw-each="cards" data-rw-state="cards" data-rw-html>' +
            '<article>0: {{ secret }}</article><article>1: Shield</article></section>'
        );
        expect(HtmlRenderer.render('<section rw-each="cards" data-rw-state="cards"></section>', cards))
            .toContain('data-rw-state="cards" data-rw-html');
        expect(HtmlRenderer.render('<section rw-each="cards" data-rw-state="cards" data-rw-html></section>', cards)
            .match(/data-rw-html/g)).toHaveLength(1);
        expect(() => HtmlRenderer.render('<section rw-each="cards" data-rw-state="other"></section>', cards))
            .toThrow('conflicts with state binding');
        expect(() => HtmlRenderer.render('<section rw-each="cards">Loading...</section>', cards))
            .toThrow('empty container');
        expect(HtmlRenderer.render("<section title='1 > 0' rw-each='cards'></section>", cards))
            .toContain('<article>0: {{ secret }}</article>');
        expect(HtmlRenderer.render('<section rw-each=cards></section>', cards))
            .toContain('<article>0: {{ secret }}</article>');
        expect(HtmlRenderer.render('<section rw-each = cards></section>', cards))
            .toContain('<article>0: {{ secret }}</article>');
        expect(() => HtmlRenderer.render('<section rw-each></section>', cards)).toThrow('valid state name');
        expect(HtmlRenderer.render("<section rw-each=\"cards\" data-rw-state='cards'></section>", cards))
            .toContain('data-rw-state=\'cards\' data-rw-html');
        expect(() => HtmlRenderer.render('<section rw-each="cards" rw-each="other"></section>', cards))
            .toThrow('Duplicate Live HTML directive');
        expect(() => HtmlRenderer.render('<section data-rw-state="cards" data-rw-state="cards"></section>', cards))
            .toThrow('Duplicate Live HTML directive');
        expect(() => HtmlRenderer.render('<section rw-each="cards" data-rw-html data-rw-html></section>', cards))
            .toThrow('Duplicate Live HTML directive');
        expect(() => HtmlRenderer.render('<section rw-each="cards" data-rw-html="yes"></section>', cards))
            .toThrow('boolean attribute');
        expect(() => HtmlRenderer.render('<div data-rw-html="yes"></div>', cards)).toThrow('boolean attribute');
        expect(() => HtmlRenderer.render('<div data-rw-html></div>', cards)).toThrow('requires data-rw-state');
        expect(HtmlRenderer.render('<p>Document rw-each= here. {{ secret }}</p>', cards))
            .toBe('<p>Document rw-each= here. <span data-rw-state="secret">LEAK</span></p>');
        expect(HtmlRenderer.render('<p>1 < 2 and {{ secret }} > 0</p>', cards))
            .toBe('<p>1 < 2 and <span data-rw-state="secret">LEAK</span> > 0</p>');
        expect(HtmlRenderer.render('<p><<script>{{ body }}</script></p>', pageState))
            .toBe('<p><<script>{{ body }}</script></p>');
        expect(HtmlRenderer.render('<p></<script>{{ body }}</script></p>', pageState))
            .toBe('<p></<script>{{ body }}</script></p>');
        expect(HtmlRenderer.render('<p></?<script>{{ body }}</script></p>', pageState))
            .toBe('<p></?<script>{{ body }}</script></p>');
        expect(HtmlRenderer.render('<script foo">{{ body }}</script>', pageState))
            .toBe('<script foo">{{ body }}</script>');
        const nbsp = '\u00a0';
        const rawNbsp = `<script>safe</script${nbsp}>{{ body }}</script>`;
        expect(HtmlRenderer.render(rawNbsp, pageState)).toBe(rawNbsp);
        expect(HtmlRenderer.render(`<div data-rw-state${nbsp}="body"></div>`, pageState))
            .toBe(`<div data-rw-state${nbsp}="body"></div>`);
        const raw = '<!-- rw-each="cards" {{ secret }} --><script>const fake = \'<i data-rw-state="secret"></i>\'; {{ secret }}</script>';
        expect(HtmlRenderer.render(raw, cards)).toBe(raw);
        expect(HtmlRenderer.render('<!-- unclosed rw-each="cards"')).toBe('<!-- unclosed rw-each="cards"');
        expect(HtmlRenderer.render('<style>{{ secret }}</style>', cards)).toBe('<style>{{ secret }}</style>');
        expect(HtmlRenderer.render('<script>{{ secret }}', cards)).toBe('<script>{{ secret }}');
        expect(HtmlRenderer.render('<script>safe</script ', cards)).toBe('<script>safe</script ');
        expect(() => HtmlRenderer.render('<script data-rw-state="secret"></script>', cards))
            .toThrow('not allowed on raw-text');
        expect(HtmlRenderer.render('<title>{{ secret }}</title><textarea>{{ secret }}</textarea>', cards))
            .toBe('<title>{{ secret }}</title><textarea>{{ secret }}</textarea>');
        expect(HtmlRenderer.render('<noscript>{{ body }}</noscript>', pageState))
            .toBe('<noscript>{{ body }}</noscript>');
        const plaintext = '<plaintext>safe</plaintext><p>{{ secret }}</p>';
        expect(HtmlRenderer.render(plaintext, cards)).toBe(plaintext);
        expect(HtmlRenderer.render('<script>İ</script><p>{{ secret }}</p>', cards))
            .toBe('<script>İ</script><p><span data-rw-state="secret">LEAK</span></p>');
        expect(HtmlRenderer.render('<SCRIPT>safe</SCRIPT>', cards)).toBe('<SCRIPT>safe</SCRIPT>');
        const manyRawElements = '<script>safe</script>'.repeat(20_000);
        expect(HtmlRenderer.render(manyRawElements, cards)).toBe(manyRawElements);
        expect(HtmlRenderer.render('<!doctype html><p>ok</p>', cards)).toBe('<!doctype html><p>ok</p>');
        expect(HtmlRenderer.render('<?instruction?><p title=value>ok</p>', cards))
            .toBe('<?instruction?><p title=value>ok</p>');
        expect(HtmlRenderer.render('<br/>', cards)).toBe('<br/>');
        expect(HtmlRenderer.render('<br disabled />', cards)).toBe('<br disabled />');
        expect(HtmlRenderer.render('<p title=value >ok</p>', cards)).toBe('<p title=value >ok</p>');
        expect(HtmlRenderer.render('<', cards)).toBe('<');
        expect(HtmlRenderer.render('<a', cards)).toBe('<a');
        expect(() => HtmlRenderer.render('<section /bad></section>', cards)).toThrow('Malformed HTML attribute');
        expect(() => HtmlRenderer.render('<div data-rw-state></div>', cards)).toThrow('valid state name');
        expect(() => HtmlRenderer.render('<div data-rw-state="missing"></div>', cards)).toThrow('Unknown page binding');
        expect(HtmlRenderer.render('<div data-rw-state="secret"></div>', cards))
            .toBe('<div data-rw-state="secret">LEAK</div>');
        expect(HtmlRenderer.render('<div data-rw-state="secret"> \n </div>', cards))
            .toBe('<div data-rw-state="secret">LEAK \n </div>');
        expect(HtmlRenderer.render('<div data-rw-state="body" data-rw-html></div>', pageState))
            .toContain('<b>safe {{ secret }}</b>');
        expect(HtmlRenderer.render('<h1>{{ title }}</h1>', pageState, { live: false })).toBe('<h1>&lt;unsafe&gt;</h1>');
        expect(() => HtmlRenderer.render('text', pageState, null)).toThrow('Render options');
        expect(() => HtmlRenderer.render('text', pageState, { live: 'no' })).toThrow('Render live');
        expect(() => HtmlRenderer.render('<div data-rw-state="secret">', cards)).toThrow('empty container');
        expect(HtmlRenderer.render('<section title="unclosed', cards)).toBe('<section title="unclosed');
        expect(HtmlRenderer.render('<section title="{{ secret }}', cards)).toBe('<section title="{{ secret }}');
        expect(HtmlRenderer.render('<?instruction {{ secret }}', cards)).toBe('<?instruction {{ secret }}');
        expect(HtmlRenderer.render('<!doctype {{ secret }}', cards)).toBe('<!doctype {{ secret }}');
        expect(HtmlRenderer.render('</section {{ secret }}', cards)).toBe('</section {{ secret }}');
        expect(HtmlRenderer.statePayload('cards', cards.cards, cards)).toEqual({
            name: 'cards',
            value: '<article>0: {{ secret }}</article><article>1: Shield</article>',
            html: true,
        });
        expect(() => HtmlRenderer.render('<section rw-each="missing"></section>', cards)).toThrow('Unknown page collection');
        cards.cards = null;
        expect(() => HtmlRenderer.collection(cards, 'cards', cards.cards)).toThrow('must be an array');
        class MissingView { items = []; }
        state()(MissingView.prototype, 'items');
        expect(() => HtmlRenderer.collection(new MissingView(), 'items', [])).toThrow('missing @view');
        class UnsafeView { items = ['unsafe']; item() { return '<b>unsafe</b>'; } }
        state()(UnsafeView.prototype, 'items');
        decorateView(UnsafeView, 'items', 'item');
        expect(() => HtmlRenderer.collection(new UnsafeView(), 'items', ['unsafe'])).toThrow('must return html');
        class MissingState { items = []; item() { return html`<i>item</i>`; } }
        decorateView(MissingState, 'items', 'item');
        expect(() => HtmlRenderer.collection(new MissingState(), 'items', [])).toThrow('missing @state');
        class ShadowedCards extends CardsPage {
            constructor() {
                super();
                this.card = () => html`<p>shadow</p>`;
            }
        }
        expect(() => HtmlRenderer.collection(new ShadowedCards(), 'cards', [])).toThrow('was replaced');

        const config = { pageId: '<id>', socketPath: '/live', runtimePath: '/runtime.js', version: '1' };
        const fragment = HtmlRenderer.document('<p>hello</p>', config);
        expect(fragment).toContain('<main data-rw-root><p>hello</p></main>');
        expect(fragment).toContain('"pageId":"\\u003cid>"');
        const document = HtmlRenderer.document('<html><body>hello</body></html>', config);
        expect(document).toContain('hello<script type="application/json"');
        expect(document.match(/<body>/g)).toHaveLength(1);
        const styledDocument = HtmlRenderer.document(
            '<html><head><title>Styled</title></head><body>hello</body></html>', config, ['/one.css', '/two.css']
        );
        expect(styledDocument).toContain('<link rel="stylesheet" href="/one.css"><link rel="stylesheet" href="/two.css"></head>');
        expect(HtmlRenderer.document('<html><body>hello</body></html>', config, ['/page.css']))
            .toContain('<head><link rel="stylesheet" href="/page.css"></head><body>hello<script');
        expect(HtmlRenderer.document('<html><body data-label="a > b">hello</body></html>', config, ['/quoted.css']))
            .toContain('<head><link rel="stylesheet" href="/quoted.css"></head><body data-label="a > b">hello<script');
        expect(HtmlRenderer.document('<p>hello</p>', config, ['/fragment.css']))
            .toContain('<head><link rel="stylesheet" href="/fragment.css"></head>');
        const hostilePath = '/asset"><script>window.injected=true</script>';
        const escapedDocument = HtmlRenderer.document('<p>safe</p>', { ...config, runtimePath: hostilePath }, [hostilePath]);
        expect(escapedDocument).not.toContain('<script>window.injected=true</script>');
        expect(escapedDocument).toContain('href="/asset&quot;&gt;&lt;script&gt;window.injected=true&lt;/script&gt;"');
        expect(escapedDocument).toContain('src="/asset&quot;&gt;&lt;script&gt;window.injected=true&lt;/script&gt;"');
        const scriptBody = '<html><head></head><body><script>const fake = "</body>";</script>safe</body></html>';
        const bootstrapped = HtmlRenderer.document(scriptBody, config, ['/safe.css']);
        expect(bootstrapped).toContain('<script>const fake = "</body>";</script>safe<script type="application/json"');
        expect(bootstrapped).toContain('<link rel="stylesheet" href="/safe.css"></head>');
        expect(HtmlRenderer.document('plain text', config)).toContain('<main data-rw-root>plain text</main>');
        expect(HtmlRenderer.document('<!-- fake </body> --><body>safe</body>', config))
            .toContain('<body>safe<script type="application/json"');
        expect(HtmlRenderer.document('<body><<span>safe</span></body>', config))
            .toContain('<body><<span>safe</span><script type="application/json"');
        const malformedEnd = '<body></<script>const fake = "</body>";</script>safe</body>';
        expect(HtmlRenderer.document(malformedEnd, config))
            .toContain('</script>safe<script type="application/json"');
        expect(HtmlRenderer.document('<!-- unclosed </body>', config)).toContain('<main data-rw-root><!-- unclosed </body></main>');
        expect(HtmlRenderer.document('<body title="unclosed', config)).toContain('<main data-rw-root><body title="unclosed</main>');
        expect(HtmlRenderer.document('<script>fake </body>', config)).toContain('<main data-rw-root><script>fake </body></main>');
        expect(HtmlRenderer.document('<body><noscript>fake </body></noscript>safe</body>', config))
            .toContain('</noscript>safe<script type="application/json"');
        expect(HtmlRenderer.document('<body><plaintext>fake </body></plaintext>safe</body>', config))
            .toContain('<main data-rw-root><body><plaintext>fake </body></plaintext>safe</body></main>');
        const staticDocument = HtmlRenderer.document('<html><body>Docs</body></html>', null, ['/docs.css'], {
            title: '<Redweb>',
            description: 'API "reference"',
            canonical: 'https://example.test/docs?x=1&y=2',
            image: 'https://example.test/image.png',
            robots: 'index,follow',
        });
        expect(staticDocument).toContain('<head><title>&lt;Redweb&gt;</title>');
        expect(staticDocument).toContain('<meta name="description" content="API &quot;reference&quot;">');
        expect(staticDocument).toContain('<link rel="canonical" href="https://example.test/docs?x=1&amp;y=2">');
        expect(staticDocument).toContain('<meta property="og:image" content="https://example.test/image.png">');
        expect(staticDocument).toContain('<meta name="twitter:card" content="summary_large_image">');
        expect(staticDocument).toContain('<meta name="robots" content="index,follow">');
        expect(staticDocument).not.toContain('__redweb_page');
        expect(HtmlRenderer.document('<p>Static</p>', null, [], { title: 'Static' }))
            .toContain('<meta name="twitter:card" content="summary">');
        expect(HtmlRenderer.head()).toBe('');
        expect(HtmlRenderer.document('<html><head></head><body>Empty head</body></html>'))
            .toBe('<html><head></head><body>Empty head</body></html>');
        expect(HtmlRenderer.document('</body>', null, [], { title: 'Orphan' })).toContain('<head><title>Orphan</title>');
    });

    test('generates a small delegated browser runtime around redweb-client', () => {
        const source = browserRuntime('/internal/client.js');
        expect(source).toContain("from \"/internal/client.js\"");
        expect(source).toContain("client.send('redweb:html'");
        expect(source).toContain("document.addEventListener('click'");
        expect(source).toContain("document.addEventListener('submit'");
        expect(source).toContain("document.addEventListener('input'");
    });

    test('exports non-live decorated pages and content-addressed CSS as static files', async () => {
        await expect(exportStatic(null, { outDir: 'dist' })).rejects.toThrow('page class');
        class Undecorated {}
        await expect(exportStatic(Undecorated, null)).rejects.toThrow('options');
        await expect(exportStatic(Undecorated)).rejects.toThrow('outDir');
        await expect(exportStatic(Undecorated, {})).rejects.toThrow('outDir');

        class LiveExport { render() { return '<p>live</p>'; } }
        page('/live-export')(LiveExport);
        await expect(exportStatic(LiveExport, { outDir: path.join(os.tmpdir(), 'unused-redweb-export') }))
            .rejects.toThrow('live: false');
        const failedOutput = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-failed-export-'));
        class ValidBeforeLive { render() { return '<p>valid</p>'; } }
        page('/valid-before-live', { live: false })(ValidBeforeLive);
        await expect(exportStatic([ValidBeforeLive, LiveExport], { outDir: failedOutput })).rejects.toThrow('live: false');
        expect(fs.existsSync(path.join(failedOutput, 'valid-before-live', 'index.html'))).toBe(false);
        class FailedRender { render() { throw new Error('static render failed'); } }
        page('/failed-render', { live: false })(FailedRender);
        await expect(exportStatic([ValidBeforeLive, FailedRender], { outDir: failedOutput })).rejects.toThrow('static render failed');
        expect(fs.existsSync(path.join(failedOutput, 'valid-before-live', 'index.html'))).toBe(false);

        class InvalidExport { render() { return '<p>invalid</p>'; } }
        page('/:id', { live: false })(InvalidExport);
        await expect(exportStatic(InvalidExport, { outDir: path.join(os.tmpdir(), 'unused-redweb-export') }))
            .rejects.toThrow('cannot be exported');
        class TraversalExport { render() { return '<p>invalid</p>'; } }
        page('/../', { live: false })(TraversalExport);
        await expect(exportStatic(TraversalExport, { outDir: path.join(os.tmpdir(), 'unused-redweb-export') }))
            .rejects.toThrow('cannot be exported');

        class DuplicateA { render() { return '<p>a</p>'; } }
        class DuplicateB { render() { return '<p>b</p>'; } }
        page('/same', { live: false })(DuplicateA);
        page('/same/', { live: false })(DuplicateB);
        await expect(exportStatic([DuplicateA, DuplicateB], { outDir: path.join(os.tmpdir(), 'unused-redweb-export') }))
            .rejects.toThrow('same output file');
        fs.rmSync(failedOutput, { recursive: true, force: true });

        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-static-source-'));
        const output = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-static-output-'));
        try {
            fs.writeFileSync(path.join(root, 'docs.html'), '<html><body><h1>{{ title }}</h1></body></html>');
            fs.writeFileSync(path.join(root, 'docs.css'), 'body { color: red; }');
            class StaticDocs { title = 'Redweb API'; }
            page('/docs', {
                template: 'docs.html',
                css: 'docs.css',
                live: false,
                head: { title: 'Redweb Docs', description: 'API reference', canonical: 'https://example.test/docs' },
            })(StaticDocs);

            const result = await exportStatic(StaticDocs, { outDir: output, templateRoot: root, logger: null });
            expect(Object.isFrozen(result)).toBe(true);
            expect(Object.isFrozen(result.pages)).toBe(true);
            expect(result.pages).toEqual([path.join(output, 'docs', 'index.html')]);
            const document = fs.readFileSync(result.pages[0], 'utf8');
            expect(document).toContain('<h1>Redweb API</h1>');
            expect(document).toContain('<title>Redweb Docs</title>');
            expect(document).not.toContain('__redweb_page');
            expect(result.assets).toHaveLength(1);
            expect(fs.readFileSync(result.assets[0], 'utf8')).toBe('body { color: red; }');
            expect(document).toContain('/__redweb/css/');

            class RootStatic {
                render({ request }) {
                    return `<p>${request.method}:${request.path}:${request.get('missing') ?? 'none'}</p>`;
                }
            }
            page('/', { live: false })(RootStatic);
            const rootResult = await exportStatic(RootStatic, { outDir: output });
            expect(rootResult.pages).toEqual([path.join(output, 'index.html')]);
            expect(fs.readFileSync(rootResult.pages[0], 'utf8')).toContain('<p>GET:/:none</p>');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
            fs.rmSync(output, { recursive: true, force: true });
        }
    });

    test('resolves decorator source roots for filesystem and ESM call sites', () => {
        const source = path.join(os.tmpdir(), 'redweb-source', 'page.ts');
        const sourceUrl = pathToFileURL(source).href;
        expect(filePath(source)).toBe(source);
        expect(filePath(sourceUrl)).toBe(source);
        expect(callerDirectory([
            { getFileName: () => __filename },
            { getFileName: () => sourceUrl },
        ], __dirname)).toBe(path.dirname(source));
        expect(callerDirectory([{ getFileName: () => undefined }], __dirname)).toBe(process.cwd());
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
        const shadowed = new compiled.exports.ShadowedCompiledPage();
        expect(shadowed.run()).toBe('shadow');
        await expect(shadowed._invoke('run', [], {})).rejects.toThrow('Unknown page action');
        const server = compiled.exports.createCompiledServer();
        expect(server.manager.records.has('/compiled')).toBe(true);
        await server.shutdown();
    });

    test('validates page manager configuration and page registration', async () => {
        class PlainPage extends LivePage { render() { return 'ok'; } }
        page('/plain')(PlainPage);
        expect(() => new PageManager({ pages: [] })).toThrow('non-empty');
        expect(() => new PageManager({ pages: [PlainPage], templateRoot: '' })).toThrow('templateRoot');
        expect(() => new PageManager({ pages: [PlainPage], sessionTtlMs: -1 })).toThrow('sessionTtlMs');
        expect(() => new PageManager({ pages: [PlainPage], maxSessions: 0 })).toThrow('maxSessions');
        expect(() => new PageManager({ pages: [PlainPage], shutdownTimeoutMs: -1 })).toThrow('shutdownTimeoutMs');
        expect(() => new PageManager({ pages: [PlainPage], paths: null })).toThrow('paths');
        expect(() => new PageManager({ pages: [PlainPage], authenticate: true })).toThrow('authenticate');
        expect(() => new PageManager({ pages: [PlainPage], origins: [null] })).toThrow('origins');
        expect(() => new PageManager({ pages: [PlainPage], paths: { socket: 'relative' } })).toThrow('absolute');
        expect(() => new PageManager({ pages: [PlainPage], paths: { socket: '/live?unsafe="' } })).toThrow('safe');
        expect(() => new PageManager({ pages: [PlainPage], paths: { runtime: '//evil.example/runtime.js' } })).toThrow('safe');
        expect(() => new PageManager({ pages: [PlainPage], paths: { runtime: '/safe//unsafe.js' } })).toThrow('safe');
        expect(() => new PageManager({ pages: [PlainPage], paths: { socket: '/same', client: '/same' } })).toThrow('unique');
        expect(() => new PageManager({ pages: [PlainPage], paths: { css: '/assets/' } })).toThrow('trailing slash');
        expect(() => new PageManager({ pages: [PlainPage], paths: { css: '/' } })).toThrow('safe');
        expect(() => new PageManager({ pages: [PlainPage], paths: { css: '/assets', runtime: '/assets/runtime.js' } })).toThrow('css path');
        expect(() => new PageManager({ pages: [class {}] })).toThrow('missing @page');
        expect(() => new PageManager({ pages: [null] })).toThrow('must be a class');
        expect(() => new PageManager({ pages: [class extends LivePage {}] })).toThrow('missing @page');

        expect(() => LivePage.adopt(null)).toThrow('return an object');
        class ReservedPlainPage { dispose() {} }
        page('/reserved-plain', { shared: true })(ReservedPlainPage);
        expect(() => new PageManager({ pages: [ReservedPlainPage] })).toThrow('reserved member');

        expect(() => start([])).toThrow('page class');
        expect(() => start([PlainPage, null])).toThrow('page class');
        expect(() => start(PlainPage, null)).toThrow('options');
        const started = start([PlainPage], { listen: false });
        expect(started.manager.templateRoot).toBe(process.cwd());
        await started.shutdown();

        class InferredPlainPage {
            _connections = 'application-owned';
            _disposed = 'application-owned';
            message = 'inferred';
        }
        state()(InferredPlainPage.prototype, 'message');
        page('/inferred', { template: 'inferred.html' })(InferredPlainPage);
        const inferred = start(InferredPlainPage, { listen: false });
        const inferredRecord = inferred.manager.records.get('/inferred');
        expect(inferredRecord.template).toContain('{{ message }}');
        const inferredPage = inferred.manager.instantiate(inferredRecord);
        expect(inferredPage._connections).toBe('application-owned');
        expect(inferredPage._disposed).toBe('application-owned');
        expect(LivePage.isDisposed(inferredPage)).toBe(false);
        expect(inferredPage.message).toBe('inferred');
        await inferred.shutdown();
        const explicit = start(InferredPlainPage, { listen: false, templateRoot: __dirname });
        expect(explicit.manager.records.get('/inferred').template).toContain('{{ message }}');
        await explicit.shutdown();

        const sharedStyleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-shared-style-'));
        try {
            fs.writeFileSync(path.join(sharedStyleRoot, 'shared.css'), 'body { color: cyan; }');
            class FirstStyledPage { render() { return 'first'; } }
            class SecondStyledPage { render() { return 'second'; } }
            page('/first-style', { css: 'shared.css' })(FirstStyledPage);
            page('/second-style', { css: 'shared.css' })(SecondStyledPage);
            const styled = start([FirstStyledPage, SecondStyledPage], { listen: false, templateRoot: sharedStyleRoot });
            expect(styled.manager.records.get('/first-style').stylesheets)
                .toEqual(styled.manager.records.get('/second-style').stylesheets);
            expect(styled.manager.stylesheets.size).toBe(1);
            expect(styled.manager.stylesheetUrls.size).toBe(1);
            await styled.shutdown();
        } finally {
            fs.rmSync(sharedStyleRoot, { recursive: true, force: true });
        }

        class DuplicatePage extends LivePage {}
        page('/plain')(DuplicatePage);
        expect(() => new PageManager({ pages: [PlainPage, DuplicatePage] })).toThrow('Duplicate');
        class ReservedPage extends LivePage {}
        page('/__redweb/live')(ReservedPage);
        expect(() => new PageManager({ pages: [ReservedPage] })).toThrow('reserved');
        class ReservedCssPage extends LivePage {}
        page('/__redweb/css/application.css')(ReservedCssPage);
        expect(() => new PageManager({ pages: [ReservedCssPage] })).toThrow('reserved');
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

        class ZeroDeadlineCleanup extends LivePage {
            disposed() { return new Promise(() => {}); }
        }
        page('/zero-deadline')(ZeroDeadlineCleanup);
        const zeroDeadline = new PageManager({ pages: [ZeroDeadlineCleanup], shutdownTimeoutMs: 0 });
        const zeroPage = zeroDeadline.instantiate(zeroDeadline.records.get('/zero-deadline'));
        zeroDeadline.createSession(zeroPage, true);
        await expect(zeroDeadline.shutdown()).rejects.toMatchObject({ code: 'LIVE_HTML_SHUTDOWN_TIMEOUT' });

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
        await expect(slowRender).rejects.toThrow('shutting down');
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

        let releaseBodyRender;
        class SlowBodyRender extends LivePage {
            render() { return new Promise(resolve => { releaseBodyRender = () => resolve('<p>body</p>'); }); }
        }
        page('/slow-body')(SlowBodyRender);
        const slowBodyManager = new PageManager({ pages: [SlowBodyRender] });
        const slowBodyRender = slowBodyManager.render(slowBodyManager.records.get('/slow-body'), request);
        await new Promise(resolve => setImmediate(resolve));
        const slowBodyShutdown = slowBodyManager.shutdown();
        releaseBodyRender();
        await expect(slowBodyRender).rejects.toThrow('shutting down');
        await slowBodyShutdown;
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

        const failing = new LiveHtmlServer({ pages: [Page], server: express(), listen: false });
        failing.sockets.shutdown = async () => { throw new Error('socket cleanup'); };
        failing.manager.shutdown = async () => {};
        failing.http.shutdown = async () => { throw new Error('http cleanup'); };
        await expect(failing.shutdown()).rejects.toMatchObject({
            message: 'Live HTML shutdown failed.',
            errors: expect.arrayContaining([
                expect.objectContaining({ message: 'socket cleanup' }),
                expect.objectContaining({ message: 'http cleanup' }),
            ]),
        });
    });
});
