'use strict';

const UNKNOWN = Symbol('not statically known');

// A deliberately small syntax reader, not an evaluator: it never calls application functions.
class StaticSource {
    constructor(ts, program) {
        this.ts = ts;
        this.checker = program.getTypeChecker();
        this.remaining = 50000;
        this.limited = false;
        this.tainted = new Set();
        this.arrays = new Map();
        for (const source of program.getSourceFiles()) {
            const pending = [source];
            while (pending.length) {
                const node = pending.pop();
                if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
                    if (!this.api(node.expression) && !this.redwebSuper(node)) {
                        if (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)) this.taint(node.expression.expression);
                        for (const argument of node.arguments || []) this.taint(argument, true);
                    }
                } else if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
                    this.taint(node.left, true);
                    this.taint(node.right);
                } else if (ts.isDeleteExpression(node) || ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) {
                    this.taint(node.operand || node.expression);
                } else if ((ts.isReturnStatement(node) || ts.isYieldExpression(node)) && node.expression) this.taint(node.expression);
                else if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) this.taint(node.body);
                else if (ts.isForOfStatement(node)) this.taint(node.expression);
                else if (node.initializer && (
                    ts.isPropertyDeclaration(node) || ts.isParameter(node) ||
                    (ts.isVariableDeclaration(node) && (ts.isBindingPattern(node.name) || !(node.parent.flags & ts.NodeFlags.Const)))
                )) this.taint(node.initializer);
                ts.forEachChild(node, child => { pending.push(child); });
            }
        }
    }

    spend() {
        if (--this.remaining >= 0) return true;
        this.limited = true;
        return false;
    }

    redwebSuper(node) {
        const owner = node.parent?.parent?.parent;
        return Boolean(node.expression.kind === this.ts.SyntaxKind.SuperKeyword && owner && this.ts.isConstructorDeclaration(owner) &&
            ['SocketRoute', 'BaseHandler'].includes(this.api(this.base(owner.parent))));
    }

    taint(expression, bindingWrite = false) {
        const pending = [expression], seen = new Set();
        while (pending.length && this.spend()) {
            const node = pending.pop();
            if (seen.has(node)) continue;
            seen.add(node);
            if (this.ts.isIdentifier(node)) {
                const value = this.resolve(node, new Set(), true);
                if (value !== UNKNOWN && (this.ts.isArrayLiteralExpression(value) || this.ts.isObjectLiteralExpression(value) || (bindingWrite && this.ts.isClassDeclaration(value)))) {
                    this.tainted.add(value);
                    pending.push(value);
                }
            }
            this.ts.forEachChild(node, child => { pending.push(child); });
        }
    }

    resolve(node, seen = new Set(), ignoreTaint = false) {
        const ts = this.ts;
        if (!this.spend() || !node || node === UNKNOWN || seen.has(node) || seen.size >= 64 || (!ignoreTaint && this.tainted.has(node))) return UNKNOWN;
        seen.add(node);
        if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) {
            return this.resolve(node.expression, seen, ignoreTaint);
        }
        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
            const owner = this.resolve(node.expression, new Set(seen), ignoreTaint);
            if (owner !== UNKNOWN && ts.isObjectLiteralExpression(owner)) {
                const key = ts.isPropertyAccessExpression(node) ? node.name.text : this.text(node.argumentExpression);
                return this.resolve(this.property(owner, key, new Set(), ignoreTaint), seen, ignoreTaint);
            }
        }
        if (!ts.isIdentifier(node)) return node;
        let symbol = ts.isShorthandPropertyAssignment(node.parent)
            ? this.checker.getShorthandAssignmentValueSymbol(node.parent) : this.checker.getSymbolAtLocation(node);
        const imported = symbol?.declarations?.[0];
        if (imported && (ts.isImportSpecifier(imported) || ts.isNamespaceImport(imported)) && this.moduleName(imported).startsWith('redweb')) return imported;
        if (symbol?.flags & ts.SymbolFlags.Alias) symbol = this.checker.getAliasedSymbol(symbol);
        const declaration = symbol?.valueDeclaration;
        if (!declaration) return UNKNOWN;
        if (ts.isVariableDeclaration(declaration)) {
            if (!(declaration.parent.flags & ts.NodeFlags.Const)) return UNKNOWN;
            return this.resolve(declaration.initializer, seen, ignoreTaint);
        }
        if (ts.isClassDeclaration(declaration) || ts.isFunctionDeclaration(declaration)) return !ignoreTaint && this.tainted.has(declaration) ? UNKNOWN : declaration;
        return UNKNOWN;
    }

    moduleName(imported) {
        let node = imported;
        while (!this.ts.isImportDeclaration(node)) node = node.parent;
        return node.moduleSpecifier.text;
    }

    api(expression, seen = new Set()) {
        const ts = this.ts;
        const node = this.resolve(expression);
        if (node === UNKNOWN || seen.has(node) || seen.size >= 64) return null;
        seen.add(node);
        if (ts.isImportSpecifier(node) && ['redweb', 'redweb/contract'].includes(this.moduleName(node))) {
            return (node.propertyName || node.name).text;
        }
        if (ts.isPropertyAccessExpression(node)) {
            const owner = this.resolve(node.expression);
            if (owner !== UNKNOWN && ts.isNamespaceImport(owner) && ['redweb', 'redweb/contract'].includes(this.moduleName(owner))) return node.name.text;
            if (owner !== UNKNOWN && ts.isCallExpression(owner)) {
                const factory = this.api(owner.expression, seen);
                if (factory === 'defineSite' && ['page', 'export'].includes(node.name.text)) return `site.${node.name.text}`;
                if (factory === 'defineSocketContract' && node.name.text === 'handler') return 'contract.handler';
            }
        }
        return null;
    }

    text(expression) {
        const node = this.resolve(expression);
        return node !== UNKNOWN && this.ts.isStringLiteralLike(node) ? node.text : UNKNOWN;
    }

    property(expression, name, seen = new Set(), ignoreTaint = false) {
        if (!expression) return undefined;
        const node = this.resolve(expression, new Set(), ignoreTaint);
        const ts = this.ts;
        if (node === UNKNOWN || !ts.isObjectLiteralExpression(node) || seen.has(node) || seen.size >= 64) return UNKNOWN;
        seen.add(node);
        let value;
        for (const field of node.properties) {
            if (ts.isSpreadAssignment(field)) {
                const spread = this.property(field.expression, name, new Set(seen), ignoreTaint);
                if (spread !== undefined) value = spread;
            } else {
                const key = ts.isComputedPropertyName(field.name) ? this.text(field.name.expression) : field.name.text;
                if (key === UNKNOWN) value = UNKNOWN;
                else if (key === name) value = ts.isPropertyAssignment(field) ? field.initializer : ts.isShorthandPropertyAssignment(field) ? field.name : UNKNOWN;
            }
        }
        return value;
    }

    elements(expression, seen = new Set()) {
        const node = this.resolve(expression);
        if (node === UNKNOWN || seen.has(node) || seen.size >= 64) return [UNKNOWN];
        seen.add(node);
        if (!this.ts.isArrayLiteralExpression(node)) return [node];
        if (this.arrays.has(node)) return this.arrays.get(node);
        const result = [];
        for (const element of node.elements) {
            const entries = this.ts.isSpreadElement(element) ? this.elements(element.expression, new Set(seen)) : [this.resolve(element)];
            if (result.length + entries.length > 4096) { this.limited = true; return [UNKNOWN]; }
            result.push(...entries);
        }
        this.arrays.set(node, result);
        return result;
    }

    base(node) {
        const clause = node.heritageClauses?.find(value => value.token === this.ts.SyntaxKind.ExtendsKeyword);
        return clause ? clause.types[0].expression : UNKNOWN;
    }

    constructorArgument(expression, api, seen = new Set()) {
        const node = this.resolve(expression);
        if (node === UNKNOWN || seen.has(node) || seen.size >= 64 || !this.ts.isClassDeclaration(node)) return UNKNOWN;
        seen.add(node);
        const base = this.base(node);
        const constructor = node.members.find(member => this.ts.isConstructorDeclaration(member));
        const property = api === 'SocketRoute' ? 'path' : 'name';
        if (node.members.some(member => member.name && (this.ts.isComputedPropertyName(member.name) || member.name.text === property))) return UNKNOWN;
        if (this.ts.getDecorators(node)?.length || node.members.some(member =>
            this.ts.isClassStaticBlockDeclaration(member) || (this.ts.isPropertyDeclaration(member) && member.initializer) ||
            (this.ts.canHaveDecorators(member) && this.ts.getDecorators(member)?.length))) return UNKNOWN;
        if (constructor?.parameters.some(parameter => parameter.modifiers?.some(modifier =>
            [this.ts.SyntaxKind.PublicKeyword, this.ts.SyntaxKind.PrivateKeyword, this.ts.SyntaxKind.ProtectedKeyword, this.ts.SyntaxKind.ReadonlyKeyword].includes(modifier.kind)))) return UNKNOWN;
        if (this.api(base) !== api) return constructor ? UNKNOWN : this.constructorArgument(base, api, seen);
        if (constructor?.body?.statements.length !== 1) return UNKNOWN;
        const statement = constructor?.body?.statements.find(item => this.ts.isExpressionStatement(item) &&
            this.ts.isCallExpression(item.expression) && item.expression.expression.kind === this.ts.SyntaxKind.SuperKeyword);
        return statement?.expression.arguments[0] || UNKNOWN;
    }
}

module.exports = { StaticSource, UNKNOWN };
