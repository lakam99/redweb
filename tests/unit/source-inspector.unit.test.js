'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const ts = require('typescript');
const SourceInspector = require('../../src/cli/SourceInspector');

describe('read-only source diagnostics using the real TypeScript parser', () => {
    let root;
    beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-source-')); });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    function file(name, content = '') {
        const target = path.join(root, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
        return target;
    }

    function inspect(sources) {
        return new SourceInspector(ts, root, { fileNames: sources, options: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10 } }).inspect();
    }

    test('unified definitions inspect page assets and socket registrations without combining independent apps', () => {
        const source = file('app.ts', `
            import { defineApp as define, Application, page, SocketRoute, BaseHandler } from 'redweb';
            @page('/', { css: 'missing.css' }) class Home {}
            @page('/') class Other {}
            class Join extends BaseHandler { constructor() { super('join'); } }
            class Match extends SocketRoute { constructor() { super({ path: '/match', handlers: [Join] }); } }
            define({ pages: [Home, Other], sockets: [Match, Match] });
            new Application({ pages: [Other], sockets: [Match] });
            define({});
            define();
            define({ sockets: [] });
            define({ pages: [] });
            throw new Error('Application code must never execute');
        `);
        const report = inspect([source]);
        expect(report.issues.map(issue => issue.code).sort()).toEqual(['ASSET_UNAVAILABLE', 'DUPLICATE_ROUTE', 'DUPLICATE_ROUTE']);
        expect(report.source.registrations).toBe(7);
        expect(report.source.unresolved).toBe(0);
    });

    test('finds missing and escaping assets plus duplicate pages in the same registration', () => {
        file('src/app.css', 'body {}');
        const source = file('src/app.tsx', `
            import { page as route, start as serve } from 'redweb';
            const styles = ['app.css', 'missing.css'] as const;
            @route('/', { css: styles, template: '../outside.html' }) class Home {}
            @route('/') class Other {}
            const pages = [Home, Other];
            serve(pages);
            throw new Error('Doctor must never run this application');
        `);
        const report = inspect([source]);
        expect(report.issues.map(issue => issue.code).sort()).toEqual(['ASSET_OUTSIDE_ROOT', 'ASSET_UNAVAILABLE', 'DUPLICATE_ROUTE']);
        expect(report.issues.every(issue => issue.file === 'src/app.tsx' && issue.line > 0 && issue.column > 0)).toBe(true);
        expect(report.source).toEqual({ files: 1, registrations: 1, mode: 'static-source', unresolved: 0 });
        expect(fs.readdirSync(root)).toEqual(['src']);
    });

    test('keeps independent servers separate and follows imported constants and namespace aliases', () => {
        const pages = file('pages.ts', `
            import * as rw from 'redweb';
            const defaults = { css: 'base.css' };
            const site = rw.defineSite(defaults);
            @site.page('/') export class Home {}
            @site.page('/') export class Other {}
            export const first = [Home];
        `);
        file('base.css');
        const app = file('app.ts', `
            import * as rw from 'redweb';
            import { first, Other } from './pages';
            const serve = rw.start;
            serve([...first]);
            new rw.LiveHtmlServer({ pages: [Other] });
            const site = rw.defineSite();
            site.export(first, { outDir: 'dist' });
            rw.exportStatic(Other, { outDir: 'other' });
        `);
        const report = inspect([pages, app]);
        expect(report.issues).toEqual([]);
        expect(report.source.registrations).toBe(4);
        // A tsconfig files list need not enumerate every local module it imports.
        expect(inspect([app]).issues).toEqual([]);
        expect(inspect([app]).source.files).toBe(2);
    });

    test('honors explicit roots, site-level CSS roots, shorthand properties and known spreads', () => {
        file('assets/app.css');
        file('site/shared.css');
        const site = file('site/site.ts', `import { defineSite } from 'redweb'; export const site = defineSite({ css: 'shared.css' });`);
        const page = file('pages/page.ts', `
            import { site } from '../site/site';
            import { page } from 'redweb';
            const css = 'app.css';
            const options = { css };
            @page('/', { ...options }) export class Explicit {}
            const decorate = site.page;
            @decorate('/about') export class About {}
        `);
        const app = file('app.ts', `
            import { start } from 'redweb'; import { Explicit, About } from './pages/page';
            const templateRoot = 'assets';
            start(Explicit, { templateRoot });
            start(About);
        `);
        expect(inspect([site, page, app]).issues).toEqual([]);
    });

    test('checks literal constructor registrations and contract handler factories', () => {
        const source = file('sockets.ts', `
            import { SocketRoute, SocketServer, SecureSocketServer, BaseHandler } from 'redweb';
            import { defineSocketContract as contract } from 'redweb/contract';
            const match = contract('1', {});
            const Join = match.handler('join', () => {});
            const Again = match.handler('join', () => {});
            class Move extends BaseHandler { constructor() { super('move'); } }
            class InheritedMove extends Move {}
            class First extends SocketRoute { constructor() { super({ path: '/match', handlers: [Join, Again, Move, InheritedMove] }); } }
            class Second extends First {}
            new SocketServer({ routes: [First, Second] });
            new SecureSocketServer({ routes: [First] });
            new SocketRoute({ path: '/separate', handlers: [Move, Move] });
            new SocketServer();
        `);
        const report = inspect([source]);
        expect(report.issues.filter(issue => issue.code === 'DUPLICATE_HANDLER')).toHaveLength(5);
        expect(report.issues.filter(issue => issue.code === 'DUPLICATE_ROUTE')).toHaveLength(1);
        expect(report.issues.filter(issue => issue.code === 'SOURCE_UNRESOLVED')).toEqual([]);
    });

    test('reports dynamic configuration instead of executing it or guessing', () => {
        const source = file('dynamic.ts', `
            import { page, start, SocketRoute, SocketServer, BaseHandler } from 'redweb';
            const opts = JSON.parse(process.env.OPTIONS);
            let pages = [];
            @page('/') class Page {}
            @page('/next', { css: opts.css }) class DynamicAsset {}
            @page('/last', { ...opts }) class DynamicOptions {}
            start(Page, { templateRoot: 'assets', ...opts });
            start(pages);
            start(DynamicAsset);
            start(DynamicOptions);
            class Dynamic extends SocketRoute { constructor() { super(opts); } }
            class Changed extends Dynamic { path = '/changed'; }
            class Imperative extends SocketRoute { constructor() { super({path:'/a',handlers:[]}); this.path='/b'; } }
            class ChangedConstructor extends Dynamic { constructor() { super(); } }
            new SocketServer({ routes: [Dynamic, Changed, Imperative, ChangedConstructor] });
            class NoDecorator {}
            start(NoDecorator);
        `);
        const report = inspect([source]);
        expect(report.issues.length).toBeGreaterThanOrEqual(7);
        expect(report.issues.every(issue => issue.code === 'SOURCE_UNRESOLVED' && issue.severity === 'warning')).toBe(true);
    });

    test('handles source syntax, unavailable files, directories, declaration files, and source-size limits', () => {
        const broken = file('broken.ts', 'const value = ;');
        const declaration = file('types.d.ts', 'declare const x: number;');
        const large = file('large.ts', ' '.repeat(8 * 1024 * 1024 + 1));
        const report = inspect([broken, declaration, large, path.join(root, 'missing.ts'), root]);
        expect(report.issues.map(issue => issue.code).sort()).toEqual(['SOURCE_LIMIT', 'SOURCE_SYNTAX', 'SOURCE_UNREADABLE', 'SOURCE_UNREADABLE']);
        expect(report.source.files).toBe(1);
        expect(inspect(Array.from({ length: 257 }, (_, i) => file(`many/${i}.ts`, 'export {};'))).issues[0].code).toBe('SOURCE_LIMIT');
    });

    test('rejects directory assets and links outside the declared root; accepts the source __dirname root', () => {
        file('outside/a.css');
        fs.mkdirSync(path.join(root, 'src', 'directory'), { recursive: true });
        fs.symlinkSync(path.join(root, 'outside'), path.join(root, 'src', 'linked'), 'junction');
        file('src/ok.css');
        const source = file('src/app.ts', `
            import { page, start } from 'redweb';
            @page('/', { css: ['directory', 'linked/a.css', 'ok.css'] }) class Page {}
            start(Page, { templateRoot: __dirname });
        `);
        const report = inspect([source]);
        expect(report.issues.map(issue => issue.code).sort()).toEqual(['ASSET_NOT_FILE', 'ASSET_OUTSIDE_ROOT']);
    });

    test('ignores unrelated APIs and terminates on cyclic aliases and structures', () => {
        const source = file('cycles.ts', `
            import { start, page, defineSite, SocketServer } from 'redweb';
            import { start as unrelated } from 'redweb-other';
            const other = { start() {} }; other.start(); unrelated();
            const a = b; const b = a;
            start(a);
            const array = [...array]; start(array);
            const options = { ...options }; @page('/', options) class Page {}
            start(Page);
            const site = site.page(); site.page('/');
            class A extends B {} class B extends A {}
            new SocketServer({ routes: [A] });
        `);
        expect(inspect([source]).issues.every(issue => issue.code === 'SOURCE_UNRESOLVED')).toBe(true);
    });

    test('bounds repeated array and object spread expansion, not just recursion depth', () => {
        for (const kind of ['array', 'object']) {
            const declarations = Array.from({ length: 30 }, (_, i) => kind === 'array'
                ? `const value${i + 1} = [...value${i}, ...value${i}];`
                : `const value${i + 1} = {...value${i}, ...value${i}};`).join('\n');
            const source = file(`spread-${kind}.ts`, `
                import { start, page } from 'redweb';
                @page('/') class Page {}
                const value0 = ${kind === 'array' ? '[Page]' : '{}'};
                ${declarations}
                start(${kind === 'array' ? 'value30' : 'Page, value30'});
            `);
            const started = performance.now();
            expect(inspect([source]).issues.some(issue => issue.code === 'SOURCE_LIMIT')).toBe(true);
            expect(performance.now() - started).toBeLessThan(3000);
        }
    });

    test('mutated or escaped aggregate constants are unknown rather than stale facts', () => {
        for (const mutation of [
            'pages.pop();', 'pages.push(Other);', 'pages[0] = Other;', 'delete pages[0];',
            'consume(pages);', 'consume({ pages });', 'const alias = pages; alias.reverse();',
            'const box = { pages }; box.pages.pop();', 'const box = { pages }; const alias = box.pages; alias.pop();',
            'const box = { pages }; const alias = box["pages"]; alias.pop();',
            'const box = { pages }; const { pages: alias } = box; alias.pop();',
            'function leak() { return pages; }',
            'let alias; alias = pages; alias.pop();',
            'let alias = pages; alias.pop();',
            'const box = {}; box.pages = pages; box.pages.pop();',
            'const getPages = () => pages; getPages().pop();',
            'class Store { value = pages; } new Store().value.pop();',
            'function mutate(value = pages) { value.pop(); } mutate();',
            'function* leak() { yield pages; } leak().next().value.pop();',
            'for (const value of [pages]) value.pop();',
        ]) {
            const source = file('mutated.ts', `
                import { start, page } from 'redweb';
                @page('/') class Page {} @page('/') class Other {}
                const pages = [Page, Other];
                ${mutation}
                start(pages);
            `);
            const report = inspect([source]);
            expect(report.issues.map(issue => issue.code)).toEqual(['SOURCE_UNRESOLVED']);
        }
    });

    test('parameter properties, initializers and unknown decorators prevent stale constructor certainty', () => {
        const source = file('constructors.ts', `
            import { SocketRoute, SocketServer } from 'redweb';
            class A extends SocketRoute { constructor(public path = '/a') { super({ path:'/same', handlers:[] }); } }
            class B extends SocketRoute { constructor(private other = '/b') { super({ path:'/same', handlers:[] }); } }
            class C extends SocketRoute { other = (this.path = '/c'); constructor() { super({path:'/same',handlers:[]}); } }
            @replaceClass class D extends SocketRoute { constructor() { super({path:'/same',handlers:[]}); } }
            class E extends SocketRoute { static { change(E); } constructor() { super({path:'/same',handlers:[]}); } }
            class F extends SocketRoute { @replaceMethod example() {} constructor() { super({path:'/same',handlers:[]}); } }
            new SocketServer({ routes:[A,B,C,D,E,F] });
        `);
        expect(inspect([source]).issues.map(issue => issue.code)).toEqual(['SOURCE_UNRESOLVED']);
    });

    test('shared CSS takes precedence when a page repeats the same filename', () => {
        file('site/app.css');
        const site = file('site/site.ts', `import { defineSite } from 'redweb'; export const site = defineSite({css:'app.css'});`);
        const page = file('pages/app.ts', `
            import { site } from '../site/site'; import { start } from 'redweb';
            @site.page('/', {css:'app.css'}) class Page {}
            start(Page);
        `);
        expect(inspect([site, page]).issues).toEqual([]);
    });

    test('handles computed options, getters, unknown decorators and omitted constructor arguments conservatively', () => {
        file('ok.css');
        const source = file('syntax.ts', `
            import { page, start, defineSite, SocketRoute, SocketServer } from 'redweb';
            const key = 'css';
            @page('/', { [key]: 'ok.css' }) class Known {}
            start(Known);
            @page('/dynamic', { [process.env.FIELD]: 'ok.css' }) class Dynamic {}
            start(Dynamic);
            @page('/getter', { get css() { return 'ok.css'; } }) class Getter {}
            start(Getter);
            @custom class Custom {} start(Custom);
            @custom() class CalledCustom {} start(CalledCustom);
            const site = defineSite({}); @site.page('/site') class Site {} start(Site);
            const dynamicSite = defineSite({ css: process.env.STYLE });
            @dynamicSite.page('/dynamic-site', {css:'ok.css'}) class DynamicSite {} start(DynamicSite);
            class Empty extends SocketRoute { constructor() { super(); } }
            new SocketServer({ routes:[Empty] });
            new SocketServer;
            new Date;
            const recursive = { recursive }; consume(recursive);
        `);
        const report = inspect([source]);
        expect(report.issues.every(issue => issue.code === 'SOURCE_UNRESOLVED')).toBe(true);
        expect(report.issues.some(issue => issue.message === 'Shared stylesheet provenance is not statically known.')).toBe(true);
    });

    test('unresolved imports and unconfigured outside-project imports remain unknown', () => {
        file('external.ts', 'export class Outside {}');
        const source = file('project/app.ts', `
            import { start } from 'redweb';
            import { Missing } from './missing';
            import { Outside } from '../external';
            start([Missing, Outside]);
        `);
        const report = new SourceInspector(ts, path.join(root, 'project'), {
            fileNames: [source], options: { moduleResolution: ts.ModuleResolutionKind.Node10 },
        }).inspect();
        expect(report.source.files).toBe(1);
        expect(report.issues.map(issue => issue.code)).toEqual(['SOURCE_UNRESOLVED']);
    });

    test('reassigned class bindings do not retain their original route identity', () => {
        for (const mutation of ['A = B;', 'modify(A);', "page('/b')(A);"]) {
            const source = file('reassigned.ts', `
                import { page, start } from 'redweb';
                @page('/a') class A {} @page('/b') class B {}
                ${mutation}
                start([A, B]);
            `);
            expect(inspect([source]).issues.map(issue => issue.code)).toEqual(['SOURCE_UNRESOLVED']);
        }
    });
});
