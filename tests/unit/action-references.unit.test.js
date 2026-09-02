'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const ts = require('typescript');
const SourceInspector = require('../../src/cli/SourceInspector');

describe('action-reference diagnostics using actual source files, without application execution', () => {
    let root;
    beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-action-source-')); });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    function file(name, source) {
        const location = path.join(root, name);
        fs.writeFileSync(location, source);
        return location;
    }
    function inspect(source, files = []) {
        const inspector = new SourceInspector(ts, root, {
            fileNames: [file('app.tsx', source), ...files],
            options: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, jsx: ts.JsxEmit.ReactJSX },
        });
        return { ...inspector.inspect(), inspector };
    }
    const prefix = `import { page, component, action, state, view, start, html, LivePage } from 'redweb';`;

    test('checks aliased decorators, literal names, inheritance, helpers and isolated component owners', () => {
        const base = file('base.ts', `import { action as expose } from 'redweb'; export class Base { @expose() save() {} }`);
        const result = inspect(`${prefix}
            import { Base } from './base';
            const remove = 'remove-card';
            @page('/') class Home extends Base {
                @action() ['remove-card']() {}
                helper() { return <button rw-click={remove}>Remove</button>; }
                render() { return <><form rw-submit="save"/><button rw-click="typo"/>{this.helper()}</>; }
            }
            @component() class Card { @action() save() {} render() { return <button rw-click="save"/>; } }
            class Unrelated { render() { return <button rw-click="ignore"/>; } }
            start(Home);
            throw new Error('Application must not run');
        `, [base]);
        expect(result.issues.map(value => value.code)).toEqual(['ACTION_NOT_EXPOSED']);
        expect(result.issues[0]).toMatchObject({ file: 'app.tsx', message: expect.stringContaining('typo'), line: expect.any(Number), column: expect.any(Number) });
        expect(fs.readdirSync(root).sort()).toEqual(['app.tsx', 'base.ts']);
    });

    test('overrides, fields and private/static members do not retain inherited exposure', () => {
        const result = inspect(`${prefix}
            class Base { @action() save() {} @action() remove() {} }
            @page('/') class Home extends Base {
                save() {} remove = () => {}; @action() static admin() {} @action() #private() {}
                render() { return <><button rw-click="save"/><button rw-click="remove"/><button rw-click="admin"/><button rw-click="#private"/></>; }
            }
        `);
        expect(result.issues.map(value => value.code)).toEqual(Array(4).fill('ACTION_NOT_EXPOSED'));
    });

    test('reports dynamic bindings, custom scopes, spreads and component props without guessed errors', () => {
        const result = inspect(`${prefix}
            @component() class Child {}
            @page('/') class Home {
                @action() save() {}
                render() { return <>
                    <button rw-click={process.env.ACTION}/>
                    <button {...props} rw-click="unknown"/>
                    <section data-rw-component="child"><button rw-click="unknown"/></section>
                    <Child rw-click="unknown"/>
                    <Wrapper><button rw-click="missing"/></Wrapper>
                    <svg:path rw-click="unknown"/>
                </>; }
            }
        `);
        expect(result.issues.length).toBeGreaterThanOrEqual(5);
        expect(result.issues.every(value => value.code === 'ACTION_REFERENCE_UNRESOLVED' && value.severity === 'warning')).toBe(true);
    });

    test('rejects empty, missing and reserved literal action names', () => {
        const result = inspect(`${prefix}
            @page('/') class Home { render() { return <><button rw-click/><form rw-submit=""/><button rw-click="constructor"/><button rw-click="${'x'.repeat(129)}"/></>; } }
        `);
        expect(result.issues.map(value => value.code)).toEqual(Array(4).fill('ACTION_REFERENCE_INVALID'));
    });

    test('warns when class shape or action implementations can change', () => {
        const source = `${prefix}
            @custom @page('/') class Decorated { render() { return <button rw-click="unknown"/>; } }
            @page('/a') class UnknownBase extends makeBase() { render() { return <button rw-click="unknown"/>; } }
            @page('/b') class Replaced { @action() save() {} change() { this.save = callback; } render() { return <button rw-click="save"/>; } }
            @page('/c') class Computed { @action() [variable]() {} render() { return <button rw-click="unknown"/>; } }
            @page('/d') class Escaped { constructor() { configure(this); } render() { return <button rw-click="unknown"/>; } }
            @page('/e') class Indexed { change() { this[name] = callback; } render() { return <button rw-click="unknown"/>; } }
            @page('/f') class Static { static { configure(this); } render() { return <button rw-click="unknown"/>; } }
            @page('/g') class Methods { @custom() save() {} render() { return <button rw-click="save"/>; } }
            @page('/h') class Nested extends LivePage { @state() value = 0; @view('value') row() {} render() { class Local { render() { return <button rw-click="ignore"/>; } }; return <p/>; } }
        `;
        const result = inspect(source);
        expect(result.issues).toHaveLength(8);
        expect(result.issues.every(value => value.code === 'ACTION_REFERENCE_UNRESOLVED')).toBe(true);
    });

    test('literal HTML and external templates share the runtime scanner, ignoring comments and raw text', () => {
        const template = '<!-- <button rw-click="comment"> -->\n<script>const text = \'<button rw-click="script">\';</script>\n<button rw-click="save">Save</button>\n<form rw-submit="misspelled"></form>';
        file('home.html', template);
        const result = inspect(`${prefix}
            @page('/', {template:'home.html'}) class Home { @action() save() {} }
            @component() class Card { @action() save() {} render() { return html\`<button rw-click="save">Save</button>\`; } }
            @page('/literal') class Literal { render() { return '<button rw-click="bad">Bad</button>'; } }
            start(Home);
        `);
        expect(result.issues.map(value => value.code).sort()).toEqual(['ACTION_NOT_EXPOSED', 'ACTION_NOT_EXPOSED']);
        expect(result.issues.find(value => value.file === 'home.html')).toMatchObject({ line: 4, column: 1 });
    });

    test('HTML entities, explicit scopes, malformed attributes and interpolations are honestly unresolved', () => {
        const result = inspect(`${prefix}
            @page('/') class Home {
                @action() save() {}
                one() { return html\`<div data-rw-component="child"><button rw-click="bad"></button></div>\`; }
                two() { return html\`<button rw-click="&#115;ave"></button>\`; }
                three() { return html\`<button rw-click="save" rw-click="other"></button>\`; }
                four() { return html\`<p>\$\{this.value}</p><button rw-click="save"></button>\`; }
            }
        `);
        expect(result.issues).toHaveLength(4);
        expect(result.issues.every(value => value.code === 'ACTION_REFERENCE_UNRESOLVED')).toBe(true);
    });

    test('bounds template size and cyclic inheritance', () => {
        file('large.html', ' '.repeat(1024 * 1024 + 1));
        const result = inspect(`${prefix}
            @page('/', { template:'large.html' }) class Large { render() { return <p/>; } }
            @page('/a') class First extends Second { render() { return <button rw-click="save"/>; } }
            class Second extends First {}
            start(Large);
        `);
        expect(result.issues.every(value => value.code === 'ACTION_REFERENCE_UNRESOLVED')).toBe(true);
        expect(result.issues).toHaveLength(2);
        const owner = result.inspector.syntax.checker.getSymbolAtLocation(result.inspector.actions.descriptions.keys().next().value.name)?.valueDeclaration;
        result.inspector.actions.markup(owner, ' '.repeat(1024 * 1024 + 1), path.join(root, 'app.tsx'));
        expect(result.inspector.issues).toHaveLength(3);
    });

    test('checks inherited render methods against derived overrides and reports opaque inherited renderers', () => {
        const result = inspect(`${prefix}
            class Base { @action() save() {} render() { return <button rw-click="save"/>; } }
            @page('/') class Home extends Base { save() {} }
            @page('/opaque') class Opaque extends factory() {}
            @page('/parameter') class Parameter extends Base { constructor(public save: unknown) {} }
            @page('/nested') class Nested { field = class { render() { return <button rw-click="ignored"/>; } }; render() { return <p/>; } }
        `);
        expect(result.issues.map(issue => issue.code).sort()).toEqual(['ACTION_NOT_EXPOSED', 'ACTION_REFERENCE_UNRESOLVED', 'ACTION_REFERENCE_UNRESOLVED']);
    });

    test('aliases, returned instances, deletion and unary writes cannot silently replace an action', () => {
        const result = inspect(`${prefix}
            @page('/') class Aliased { @action() save() {} constructor() { const self = this; self.save = callback; } render() { return <button rw-click="save"/>; } }
            @page('/return') class Returned { @action() save() {} expose() { return this; } render() { return <button rw-click="save"/>; } }
            @page('/delete') class Deleted { @action() save() {} change() { delete this.save; } render() { return <button rw-click="save"/>; } }
            @page('/unary') class Unary { @action() save() {} change() { this.save++; ++this['save']; !this.other; !value; } render() { return <button rw-click="save"/>; } }
        `);
        expect(result.issues.map(issue => issue.code)).toEqual(Array(4).fill('ACTION_REFERENCE_UNRESOLVED'));
    });

    test('checks conditional returns and reports opaque render outputs without executing helpers', () => {
        const result = inspect(`${prefix}
            @page('/') class Conditional { render() { if (enabled) return '<button rw-click="missing"/>'; return enabled ? '<form rw-submit="missing"/>' : '<p>OK</p>'; } }
            @page('/dynamic') class Dynamic { render() { return \`<p>\$\{value}</p><button rw-click="missing"/>\`; } }
            @page('/helper') class Helper { render() { return buildHtml(); } }
            @page('/unknown') class Unknown { render() { return unknown; } }
            @page('/empty') class Empty { render() { return null; } }
            @page('/nested') class Nested { render() { function unused() { return '<button rw-click="ignore"/>'; } return <p/>; } }
        `);
        expect(result.issues.map(issue => issue.code).sort()).toEqual(['ACTION_NOT_EXPOSED', 'ACTION_NOT_EXPOSED', ...Array(3).fill('ACTION_REFERENCE_UNRESOLVED')]);
    });

    test('reports JSX spreads as unresolved even for constants instead of ignoring possible bindings', () => {
        const result = inspect(`${prefix}
            const save = { 'rw-click': 'save' }; const typo = { 'rw-click': 'typo' };
            @page('/') class Home { @action() save() {} render() { return <>
                <button {...save}/><button rw-click="typo" {...save}/><button {...typo} rw-click="save"/>
                <button {...{ className: 'red' }} rw-click="save"/><button {...typo}/>
                <button {...runtime}/><button {...{ 'data-rw-component': 'child' }} rw-click="save"/>
            </>; } }
        `);
        expect(result.issues.length).toBeGreaterThanOrEqual(7);
        expect(result.issues.every(issue => issue.code === 'ACTION_REFERENCE_UNRESOLVED')).toBe(true);
    });

    test('inspects function-valued render fields and warns for opaque getters and callable fields', () => {
        const result = inspect(`${prefix}
            @page('/') class Arrow { render = () => '<button rw-click="arrow"/>'; }
            @page('/block') class Block { render = () => { if (enabled) return '<button rw-click="block"/>'; return; }; }
            @page('/function') class FunctionField { render = function() { return '<button rw-click="function"/>'; }; }
            @page('/getter') class Getter { get render() { return buildRenderer(); } }
            @page('/opaque') class Opaque { render = buildRenderer(); }
        `);
        expect(result.issues.filter(issue => issue.code === 'ACTION_NOT_EXPOSED')).toHaveLength(3);
        expect(result.issues.filter(issue => issue.code === 'ACTION_REFERENCE_UNRESOLVED')).toHaveLength(2);
    });

    test('resolves external render constants and quoted methods without checking obsolete renderers', () => {
        const result = inspect(`${prefix}
            const element = <button rw-click="element"/>;
            const fragment = html\`<button rw-click="fragment"/>\`;
            @page('/') class Element { render() { return element; } }
            @page('/fragment') class Fragment { render() { return fragment; } }
            @page('/quoted') class Quoted { 'render'() { return '<button rw-click="quoted"/>'; } }
            class Base { render() { return '<button rw-click="obsolete"/>'; } }
            @page('/replaced') class Replaced extends Base { constructor(public render: unknown, plain: unknown) { super(); } }
            @page('/destructure') class Destructure { @action() save() {} change() { ({save:this.save}=source); } render() { return <button rw-click="save"/>; } }
        `);
        expect(result.issues.filter(issue => issue.severity === 'error')).toHaveLength(3);
        expect(result.issues.filter(issue => issue.severity === 'warning')).toHaveLength(2);
        expect(result.issues.some(issue => issue.message.includes('obsolete'))).toBe(false);
    });

    test('matches HTML attribute casing and traverses aliased block-bodied renderer functions', () => {
        const result = inspect(`${prefix}
            const renderView = () => { return '<button rw-click="aliased"/>'; };
            @page('/') class Aliased { render = renderView; }
            @page('/case') class Casing { render() { return <><button RW-CLICK="missing"/><section DATA-RW-COMPONENT="child"><button rw-click="childAction"/></section></>; } }
        `);
        expect(result.issues.filter(issue => issue.code === 'ACTION_NOT_EXPOSED')).toHaveLength(2);
        expect(result.issues.filter(issue => issue.code === 'ACTION_REFERENCE_UNRESOLVED')).toHaveLength(1);
    });
});
