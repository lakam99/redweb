const { html, url } = require('../..');
const { Fragment, jsx, jsxs } = require('../../jsx-runtime');
const { jsxDEV } = require('../../jsx-dev-runtime');

describe('dependency-free JSX rendering', () => {
    test('renders escaped children, fragments, arrays, and existing HTML fragments', () => {
        const result = jsxs('main', {
            children: [
                jsx('h1', { children: '<Redweb>' }),
                null,
                undefined,
                true,
                false,
                1,
                2n,
                [html`<strong>${'safe'}</strong>`],
                jsx(Fragment, { children: [jsx('i', { children: 'one' }), ' two'] }),
            ],
        });
        expect(result.toString()).toBe(
            '<main><h1>&lt;Redweb&gt;</h1>12<strong>safe</strong><i>one</i> two</main>'
        );
        expect(html`<section>${result}</section>`.toString()).toContain('<main>');
        expect(() => jsx(Fragment, { children: {} })).toThrow('JSX children');
    });

    test('serializes safe attributes with aliases, booleans, omissions, and custom names', () => {
        const inherited = { inherited: 'no' };
        const properties = Object.assign(Object.create(inherited), {
            key: 'ignored',
            className: 'card<&',
            htmlFor: 'field',
            disabled: true,
            hidden: false,
            title: null,
            role: undefined,
            'data-ready': true,
            'data-visible': false,
            'aria-busy': false,
            'aria-label': 'A&B',
            viewBox: '0 0 10 10',
        });
        expect(jsx('x-card', properties).toString()).toBe(
            '<x-card class="card&lt;&amp;" for="field" disabled data-ready="true" data-visible="false" aria-busy="false" aria-label="A&amp;B" viewBox="0 0 10 10"></x-card>'
        );
        expect(() => jsx('div', { class: 'one', className: 'two' })).toThrow('Duplicate JSX attribute');
        expect(() => jsx('div', { TITLE: 'one', title: 'two' })).toThrow('Duplicate JSX attribute');
        expect(() => jsx('div', { 'bad name': 'value' })).toThrow('Invalid JSX attribute');
    });

    test('uses the shared URL and dangerous-attribute policy', () => {
        expect(jsx('a', { href: '/docs', children: 'Docs' }).toString()).toBe('<a href="/docs">Docs</a>');
        expect(jsx('a', { href: url('#api'), children: 'API' }).toString()).toContain('href="#api"');
        expect(() => jsx('a', { href: 'javascript:alert(1)' })).toThrow('javascript:');
        expect(() => jsx('a', { href: true })).toThrow('non-empty URL');
        expect(() => jsx('button', { onClick: 'alert(1)' })).toThrow('not allowed');
        expect(() => jsx('p', { style: 'color:red' })).toThrow('not allowed');
        expect(() => jsx('iframe', { srcDoc: '<p>x</p>' })).toThrow('not allowed');
        expect(() => jsx('img', { srcSet: 'one.png 1x' })).toThrow('not allowed');
        expect(() => jsx('div', { title: {} })).toThrow('string, number');
        expect(() => jsx('div', { title: html`<b>x</b>` })).toThrow('primitive');
        expect(() => jsx('div', { title: () => 'x' })).toThrow('string, number');
    });

    test('handles void and raw-text elements without generating invalid or executable markup', () => {
        expect(jsx('input', { disabled: true }).toString()).toBe('<input disabled>');
        expect(jsx('br', { children: [false, null, ''] }).toString()).toBe('<br>');
        expect(() => jsx('img', { children: 'invalid' })).toThrow('void element');
        expect(jsx('script', {}).toString()).toBe('<script></script>');
        expect(jsx('style', { children: '' }).toString()).toBe('<style></style>');
        expect(() => jsx('script', { children: 'alert(1)' })).toThrow('external asset');
        expect(() => jsx('style', { children: 'body{}' })).toThrow('external asset');
        expect(() => jsx('plaintext', {})).toThrow('prevents subsequent HTML');
    });

    test('renders synchronous function components through production and development runtimes', async () => {
        const Badge = properties => jsx('strong', { children: properties.label });
        expect(jsx(Badge, { label: '<Ready>' }).toString()).toBe('<strong>&lt;Ready&gt;</strong>');
        expect(jsxDEV(Badge, { label: 'Dev' }, 'key', false, {}, null).toString()).toBe('<strong>Dev</strong>');
        expect(jsx(() => [jsx('i', { children: 'one' }), jsx('i', { children: 'two' })], {}).toString())
            .toBe('<i>one</i><i>two</i>');
        expect(() => jsx(() => 'unsafe', {})).toThrow('HtmlFragment');
        expect(() => jsx(async () => { throw new Error('expected'); }, {})).toThrow('synchronously');
        await new Promise(resolve => setImmediate(resolve));
    });

    test('rejects invalid element inputs and properties', () => {
        expect(() => jsx('bad name', {})).toThrow('Invalid JSX element');
        expect(() => jsx({}, {})).toThrow('element types');
        expect(() => jsx('div', [])).toThrow('properties must be an object');
        expect(() => jsx('div', 1)).toThrow('properties must be an object');
        expect(jsx('div', null).toString()).toBe('<div></div>');
    });
});
