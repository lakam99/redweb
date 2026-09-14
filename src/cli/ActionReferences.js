'use strict';

const { UNKNOWN } = require('./StaticSource');
const TemplateRenderer = require('../htmx/TemplateRenderer');

const ACTIONS = new Set(['rw-click', 'rw-submit']);
const DIRECTIVES = new Set([...ACTIONS, 'data-rw-component']);

/** Static names only. Application constructors, decorators and render functions never run. */
class ActionReferences {
    constructor(inspector) {
        this.inspector = inspector;
        this.ts = inspector.ts;
        this.read = inspector.syntax;
        this.descriptions = new Map();
    }

    unknown(node, reason) {
        this.inspector.finding('ACTION_REFERENCE_UNRESOLVED', node, reason,
            'Use a literal action name on an intrinsic HTML element, or verify this dynamic binding with a real browser test. Doctor does not execute render code.', 'warning');
    }

    decorators(node) {
        return (this.ts.getDecorators(node) || []).map(decorator => {
            const expression = decorator.expression;
            return this.ts.isCallExpression(expression) ? this.read.api(expression.expression) : null;
        });
    }

    describe(node, seen = new Set()) {
        if (this.descriptions.has(node)) return this.descriptions.get(node);
        if (node === UNKNOWN || seen.has(node) || seen.size >= 64 || !this.read.spend() || !this.ts.isClassDeclaration(node)) return { names: new Set(), members: new Map(), uncertain: true };
        seen.add(node);
        const ts = this.ts;
        const base = this.read.base(node);
        const inherited = base === UNKNOWN || this.read.api(base) === 'LivePage'
            ? { names: new Set(), members: new Map(), uncertain: false } : this.describe(this.read.resolve(base), seen);
        const names = new Set(inherited.names);
        const members = new Map(inherited.members);
        let uncertain = inherited.uncertain || this.read.resolve(node) === UNKNOWN || this.decorators(node).some(name => !['page', 'site.page', 'component'].includes(name));
        for (const member of node.members) {
            if (ts.isClassStaticBlockDeclaration(member)) uncertain = true;
            if (ts.isConstructorDeclaration(member)) {
                for (const parameter of member.parameters) if (parameter.modifiers?.length) {
                    const name = parameter.name.getText();
                    names.delete(name);
                    members.set(name, parameter);
                    uncertain = true;
                }
            }
            if (!member.name) continue;
            const name = ts.isComputedPropertyName(member.name) ? this.read.text(member.name.expression) : member.name.text;
            if (name === UNKNOWN) { uncertain = true; continue; }
            if (member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword)) continue;
            members.set(name, member);
            names.delete(name);
            const decorators = this.decorators(member);
            if (decorators.some(api => !['action', 'state', 'view'].includes(api))) uncertain = true;
            if (ts.isMethodDeclaration(member) && decorators.length === 1 && decorators[0] === 'action' && !ts.isPrivateIdentifier(member.name)) names.add(name);
        }
        // Assignments or escaping `this` can replace decorator-exposed methods after construction.
        const pending = [...node.members];
        while (pending.length && this.read.spend()) {
            const current = pending.pop();
            if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) continue;
            if (current.kind === ts.SyntaxKind.ThisKeyword && !((ts.isPropertyAccessExpression(current.parent) || ts.isElementAccessExpression(current.parent)) && current.parent.expression === current)) uncertain = true;
            if (ts.isBinaryExpression(current) && current.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && current.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
                const left = current.left;
                if (ts.isObjectLiteralExpression(left) || ts.isArrayLiteralExpression(left)) uncertain = true;
                if (ts.isElementAccessExpression(left) && left.expression.kind === ts.SyntaxKind.ThisKeyword) uncertain = true;
                if (ts.isPropertyAccessExpression(left) && left.expression.kind === ts.SyntaxKind.ThisKeyword && names.has(left.name.text)) uncertain = true;
            }
            if (ts.isDeleteExpression(current) || ts.isPrefixUnaryExpression(current) || ts.isPostfixUnaryExpression(current)) {
                const target = current.expression || current.operand;
                if ((ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) && target.expression.kind === ts.SyntaxKind.ThisKeyword && (ts.isElementAccessExpression(target) || names.has(target.name.text))) uncertain = true;
            }
            ts.forEachChild(current, child => { pending.push(child); });
        }
        const result = { names, members, uncertain };
        this.descriptions.set(node, result);
        return result;
    }

    check(owner, name, node, ambiguous) {
        const description = this.describe(owner);
        if (name === UNKNOWN || ambiguous || description.uncertain || (typeof name === 'string' && name.includes('&'))) {
            this.unknown(node, 'The action name or its owning class cannot be established statically.');
        } else if (typeof name !== 'string' || !name || name.length > 128 || ['__proto__', 'prototype', 'constructor'].includes(name)) {
            this.inspector.finding('ACTION_REFERENCE_INVALID', node, 'Action names must be non-empty strings of at most 128 characters and cannot use reserved member names.', 'Use the exact name of a public @action() method.');
        } else if (!description.names.has(name)) {
            this.inspector.finding('ACTION_NOT_EXPOSED', node, `No public @action() method named "${name}" is exposed by this class.`, 'Correct the binding name or explicitly decorate the intended instance method with @action().');
        }
    }

    jsx(owner, element) {
        const ts = this.ts;
        const attributes = element.attributes.properties;
        let ambiguous = !ts.isIdentifier(element.tagName) || !/^[a-z]/.test(element.tagName.text);
        for (let parent = element; parent && parent !== owner; parent = parent.parent) {
            const opening = ts.isJsxElement(parent) ? parent.openingElement : (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) ? parent : null;
            if (opening && (!ts.isIdentifier(opening.tagName) || !/^[a-z]/.test(opening.tagName.text) || opening.attributes.properties.some(attribute => ts.isJsxSpreadAttribute(attribute) || attribute.name.getText().toLowerCase() === 'data-rw-component'))) ambiguous = true;
        }
        for (const attribute of attributes) {
            if (ts.isJsxSpreadAttribute(attribute)) {
                this.unknown(attribute, 'Spread JSX attributes may introduce or replace an action binding or component scope.');
                continue;
            }
            const key = attribute.name.getText().toLowerCase();
            if (!ACTIONS.has(key)) continue;
            const value = attribute.initializer;
            const name = !value ? null : this.read.text(ts.isJsxExpression(value) ? value.expression : value);
            this.check(owner, name, attribute, ambiguous);
        }
    }

    markup(owner, markup, node, filename) {
        if (markup.length > 1024 * 1024) { this.unknown(node, 'HTML action inspection exceeds the 1 MiB per-template limit.'); return; }
        const source = filename ? this.ts.createSourceFile(filename, markup, this.ts.ScriptTarget.Latest, true) : null;
        const bindings = [];
        let scoped = false;
        try {
            TemplateRenderer.mapTags(markup, (tag, nameEnd, position) => {
                const fields = TemplateRenderer.attributes(tag, nameEnd, DIRECTIVES);
                if (fields.has('data-rw-component')) scoped = true;
                for (const [key, name] of fields) if (ACTIONS.has(key)) bindings.push({ name, position });
                return tag;
            });
        } catch {
            this.unknown(node, 'Malformed or interpolated HTML attributes prevent reliable action inspection.');
            return;
        }
        for (const { name, position } of bindings) {
            const location = source ? { getSourceFile: () => source, getStart: () => position } : node;
            this.check(owner, name, location, scoped);
        }
    }

    inspect(owner) {
        if (!this.decorators(owner).some(name => ['page', 'site.page', 'component'].includes(name))) return;
        const ts = this.ts;
        const description = this.describe(owner);
        const pending = [...description.members.values()];
        const visited = new Set();
        if (description.uncertain && !description.members.has('render') && this.read.base(owner) !== UNKNOWN) {
            this.unknown(owner, 'Inherited render code is not statically available.');
        }
        const renderer = description.members.get('render');
        let renderFunction = renderer;
        if (renderer && !ts.isMethodDeclaration(renderer)) {
            const initializer = this.read.resolve(renderer.initializer);
            if (initializer === UNKNOWN || !(ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
                this.unknown(renderer, 'The render implementation is not a statically available method or function.');
                visited.add(renderer);
            }
            else {
                renderFunction = initializer;
                pending.push(initializer);
                if (!ts.isBlock(initializer.body)) this.output(owner, initializer.body, pending);
            }
        }
        while (pending.length && this.read.spend()) {
            const node = pending.pop();
            if (visited.has(node)) continue;
            visited.add(node);
            if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) continue;
            if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) this.jsx(owner, node);
            if (ts.isTaggedTemplateExpression(node) && this.read.api(node.tag) === 'html') {
                if (ts.isNoSubstitutionTemplateLiteral(node.template)) this.markup(owner, node.template.text, node);
                else this.unknown(node, 'Interpolated HTML can introduce markup or change action ownership.');
            }
            if (ts.isReturnStatement(node) && node.expression) {
                let method = node.parent;
                while (method && !ts.isFunctionLike(method)) method = method.parent;
                if (method === renderFunction) this.output(owner, node.expression, pending);
            }
            ts.forEachChild(node, child => { pending.push(child); });
        }
    }

    output(owner, expression, pending) {
        const ts = this.ts;
        const node = this.read.resolve(expression);
        if (node !== UNKNOWN) {
            if (ts.isStringLiteralLike(node)) { this.markup(owner, node.text, expression); return; }
            if (ts.isJsxElement(node) || ts.isJsxFragment(node) || ts.isJsxSelfClosingElement(node) || (ts.isTaggedTemplateExpression(node) && this.read.api(node.tag) === 'html')) { pending.push(node); return; }
            if (ts.isConditionalExpression(node)) { this.output(owner, node.whenTrue, pending); this.output(owner, node.whenFalse, pending); return; }
            if ([ts.SyntaxKind.NullKeyword, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NumericLiteral].includes(node.kind)) return;
        }
        this.unknown(expression, 'Dynamic render output may introduce action bindings or change their ownership.');
    }
}

module.exports = ActionReferences;
