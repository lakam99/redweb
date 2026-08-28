const fs = require('fs');
const os = require('os');
const path = require('path');
const { defineSite, html } = require('../..');
const { getPageMetadata } = require('../../src/htmx/metadata');

describe('static site ergonomics', () => {
    test('validates site defaults and page options', async () => {
        expect(() => defineSite(null)).toThrow('object');
        expect(() => defineSite([])).toThrow('object');
        expect(() => defineSite({ unknown: true })).toThrow('Unknown site option');
        for (const origin of ['', 'docs', 'ftp://example.test', 'https://user@example.test', 'https://example.test/docs', 'https://example.test/?q=1']) {
            expect(() => defineSite({ origin })).toThrow('absolute HTTP(S) origin');
        }
        expect(() => defineSite({ css: '' })).toThrow('Site css');
        expect(() => defineSite({ css: [] })).toThrow('Site css');
        expect(() => defineSite({ css: ['base.css', null] })).toThrow('Site css');
        expect(() => defineSite({ head: null })).toThrow('Site head');
        expect(() => defineSite({ layout: true })).toThrow('Site layout');

        const site = defineSite();
        expect(Object.isFrozen(site)).toBe(true);
        expect(() => site.page('/docs', null)).toThrow('Site page options');
        expect(() => site.page('/docs', { live: true })).toThrow('live: false');
        expect(() => site.page('/docs', { css: [] })).toThrow('Page css');
        expect(() => site.page('/docs', { head: null })).toThrow('Page head');
        await expect(site.export(class Page {}, null)).rejects.toThrow('Site export options');
        await expect(site.export(class Page {})).rejects.toThrow('outDir');
        await expect(site.export(class Page {}, { outDir: 'dist', publicDir: '' })).rejects.toThrow('publicDir');
    });

    test('merges reusable defaults into frozen page metadata', () => {
        const layout = content => html`<main>${content}</main>`;
        const site = defineSite({
            origin: 'https://example.test/',
            css: ['base.css', 'base.css'],
            head: { description: 'Reference', image: '/social.png', robots: 'index,follow' },
            cache: { maxAge: 60 },
            layout,
        });
        class DocsPage { render() { return html`<h1>Docs</h1>`; } }
        site.page('/docs', { css: ['docs.css', 'base.css'], head: { title: 'Docs' } })(DocsPage);
        expect(getPageMetadata(DocsPage)).toMatchObject({
            path: '/docs',
            live: false,
            css: ['base.css', 'docs.css'],
            head: {
                title: 'Docs',
                description: 'Reference',
                canonical: 'https://example.test/docs',
                image: 'https://example.test/social.png',
                robots: 'index,follow',
            },
            cache: { maxAge: 60 },
            layout,
        });

        const overrideLayout = content => html`<article>${content}</article>`;
        class OverridePage { render() { return html`override`; } }
        site.page('/override', {
            layout: overrideLayout,
            cache: { maxAge: 1 },
            head: { canonical: 'https://other.test/page', image: 'https://other.test/image.png' },
        })(OverridePage);
        expect(getPageMetadata(OverridePage)).toMatchObject({
            layout: overrideLayout,
            cache: { maxAge: 1 },
            head: { canonical: 'https://other.test/page', image: 'https://other.test/image.png' },
        });
    });

    test('exports layouts, styles, and public files without mocks', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-site-'));
        const outDir = path.join(root, 'dist');
        const publicDir = path.join(root, 'public');
        try {
            fs.mkdirSync(publicDir);
            fs.writeFileSync(path.join(root, 'base.css'), 'body { color: navy; }');
            fs.writeFileSync(path.join(publicDir, 'favicon.txt'), 'redweb');
            const site = defineSite({
                css: 'base.css',
                layout: (content, context) => html`<body data-path="${context.request.path}">${content}</body>`,
            });
            class DocsPage { render() { return html`<h1>${'Docs'}</h1>`; } }
            site.page('/docs')(DocsPage);
            const result = await site.export(DocsPage, { outDir, publicDir, templateRoot: root, logger: null });
            expect(result.pages).toEqual([path.join(outDir, 'docs', 'index.html')]);
            const document = fs.readFileSync(result.pages[0], 'utf8');
            expect(document).toContain('<body data-path="/docs"><h1>Docs</h1></body>');
            expect(fs.readFileSync(path.join(outDir, 'favicon.txt'), 'utf8')).toBe('redweb');
            expect(fs.readFileSync(result.assets[0], 'utf8')).toBe('body { color: navy; }');

            await expect(site.export(DocsPage, { outDir: publicDir, publicDir })).rejects.toThrow('cannot be the publicDir');
            await expect(site.export(DocsPage, { outDir: path.join(publicDir, 'nested'), publicDir }))
                .rejects.toThrow('descendants');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('rejects unsafe layout results during a real static render', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-layout-'));
        try {
            class UnsafePage { render() { return html`safe`; } }
            defineSite({ layout: () => '<main>unsafe</main>' }).page('/unsafe')(UnsafePage);
            await expect(defineSite().export(UnsafePage, { outDir: path.join(root, 'unsafe'), logger: null }))
                .rejects.toThrow('must return html');

            class AsyncPage { render() { return html`safe`; } }
            defineSite({ layout: async content => html`<main>${content}</main>` }).page('/async')(AsyncPage);
            await expect(defineSite().export(AsyncPage, { outDir: path.join(root, 'async'), logger: null }))
                .rejects.toThrow('synchronously');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
