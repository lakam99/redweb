'use strict';

const fs = require('fs');
const path = require('path');
const { StaticSource, UNKNOWN } = require('./StaticSource');
const ActionReferences = require('./ActionReferences');

const MAX_FILES = 256;
const MAX_BYTES = 8 * 1024 * 1024;

function outside(root, file) {
    const relative = path.relative(root, file);
    return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

class SourceInspector {
    constructor(ts, root, config) {
        this.ts = ts;
        this.root = root;
        this.config = config;
        this.issues = [];
        this.reported = new Set();
        this.registrations = 0;
    }

    finding(code, node, message, suggestion, severity = 'error') {
        const file = typeof node === 'string' ? node : node.getSourceFile().fileName;
        const location = typeof node === 'string' ? {} : (() => {
            const point = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart());
            return { line: point.line + 1, column: point.character + 1 };
        })();
        const entry = { code, severity, file: path.relative(this.root, file).replaceAll('\\', '/'), ...location, message, suggestion };
        const key = JSON.stringify(entry);
        if (!this.reported.has(key)) { this.reported.add(key); this.issues.push(entry); }
    }

    unknown(node, subject) {
        this.finding('SOURCE_UNRESOLVED', node, `${subject} is not statically known.`,
            'Use explicit constants/arrays for inspection, or verify this dynamic configuration with application tests. Doctor does not execute it.', 'warning');
    }

    inspect() {
        const ts = this.ts;
        const sources = new Map();
        const pendingFiles = [...this.config.fileNames];
        const visited = new Set();
        let bytes = 0;
        for (const file of pendingFiles) {
            if (visited.has(file) || /\.d\.[cm]?ts$/.test(file)) continue;
            visited.add(file);
            try {
                const details = fs.statSync(file);
                if (!details.isFile()) throw new TypeError('Source is not a regular file.');
                const size = details.size;
                if (sources.size >= MAX_FILES || size > MAX_BYTES - bytes) {
                    this.finding('SOURCE_LIMIT', file, 'Source inspection reached its 256-file or 8 MiB limit.', 'Split large projects into smaller TypeScript configurations for inspection.', 'warning');
                    continue;
                }
                const content = fs.readFileSync(file, 'utf8');
                bytes += Buffer.byteLength(content);
                const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
                sources.set(path.resolve(file), source);
                for (const dependency of ts.preProcessFile(content).importedFiles) {
                    if (!dependency.fileName.startsWith('.')) continue;
                    const imported = ts.resolveModuleName(dependency.fileName, file, this.config.options, ts.sys).resolvedModule;
                    if (imported && !outside(this.root, imported.resolvedFileName)) pendingFiles.push(imported.resolvedFileName);
                }
                for (const diagnostic of source.parseDiagnostics) {
                    this.finding('SOURCE_SYNTAX', file, ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'), 'Correct the source syntax, then run doctor again.');
                }
            } catch (error) {
                this.finding('SOURCE_UNREADABLE', file, `Cannot inspect source (${error.code || error.name}).`, 'Check that this configured source is a readable file.');
            }
        }
        // No imports, plugins, or application modules execute. Project source imports are parsed, not loaded.
        const options = { ...this.config.options, noLib: true, noResolve: true, types: [], noEmit: true };
        const host = ts.createCompilerHost(options);
        host.getSourceFile = file => sources.get(path.resolve(file));
        const program = ts.createProgram([...sources.keys()], options, host);
        this.syntax = new StaticSource(ts, program);
        this.actions = new ActionReferences(this);
        for (const source of sources.values()) {
            const pending = [source];
            while (pending.length) {
                const node = pending.pop();
                this.visit(node);
                ts.forEachChild(node, child => { pending.push(child); });
            }
        }
        if (this.syntax.limited) this.finding('SOURCE_LIMIT', path.join(this.root, 'tsconfig.json'),
            'Source expressions exceeded the 50,000-operation or 4,096-entry expansion limit.',
            'Simplify large spread/alias structures or validate the dynamic configuration with application tests.', 'warning');
        return { issues: this.issues, source: { files: sources.size, registrations: this.registrations, mode: 'static-source', unresolved: this.issues.filter(issue => issue.severity === 'warning').length } };
    }

    visit(node) {
        const ts = this.ts;
        const read = this.syntax;
        if (ts.isClassDeclaration(node)) {
            this.actions.inspect(node);
            const options = read.constructorArgument(node, 'SocketRoute');
            if (options !== UNKNOWN) this.group(read.property(options, 'handlers'), 'handler', node);
        }
        if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return;
        const api = read.api(node.expression);
        const args = node.arguments || [];
        if (['start', 'exportStatic', 'site.export'].includes(api)) {
            this.group(args[0], 'page', node, args[1]);
        } else if (api === 'LiveHtmlServer') {
            this.group(read.property(args[0], 'pages'), 'page', node, args[0]);
        } else if (['defineApp', 'Application'].includes(api)) {
            for (const [field, kind] of [['pages', 'page'], ['sockets', 'route']]) {
                const registrations = read.property(args[0], field);
                if (registrations !== undefined) this.group(registrations, kind, node, args[0]);
            }
        } else if (['SocketServer', 'SecureSocketServer'].includes(api)) {
            const routes = read.property(args[0], 'routes');
            if (routes !== undefined) this.group(routes, 'route', node);
        } else if (api === 'SocketRoute') {
            this.group(read.property(args[0], 'handlers'), 'handler', node);
        }
    }

    page(expression) {
        const node = this.syntax.resolve(expression);
        if (node === UNKNOWN || !this.ts.isClassDeclaration(node)) return null;
        const decorators = this.ts.getDecorators(node) || [];
        if (decorators.length !== 1) return null;
        for (const decorator of decorators) {
            const call = decorator.expression;
            if (this.ts.isCallExpression(call) && ['page', 'site.page'].includes(this.syntax.api(call.expression))) return call;
        }
        return null;
    }

    name(expression, kind) {
        const read = this.syntax;
        if (kind === 'page') return read.text(this.page(expression)?.arguments[0]);
        if (kind === 'route') return read.text(read.property(read.constructorArgument(expression, 'SocketRoute'), 'path'));
        const node = read.resolve(expression);
        if (node !== UNKNOWN && this.ts.isCallExpression(node) && read.api(node.expression) === 'contract.handler') return read.text(node.arguments[0]);
        return read.text(read.constructorArgument(expression, 'BaseHandler'));
    }

    group(expression, kind, registration, options) {
        this.registrations++;
        const known = new Map();
        for (const item of this.syntax.elements(expression)) {
            const name = this.name(item, kind);
            if (name === UNKNOWN) { this.unknown(registration, `${kind} registration`); continue; }
            if (known.has(name)) {
                this.finding(kind === 'handler' ? 'DUPLICATE_HANDLER' : 'DUPLICATE_ROUTE', registration,
                    `Duplicate ${kind} "${name}" in the same registration.`, 'Keep one registration per path/message type in this server or route.');
            }
            known.set(name, item);
            if (kind === 'page') this.assets(this.page(item), options, registration);
        }
    }

    assets(page, options, registration) {
        const read = this.syntax;
        const configuredRoot = read.property(options, 'templateRoot');
        let root;
        if (configuredRoot !== undefined) {
            const literal = read.text(configuredRoot);
            if (literal !== UNKNOWN) root = path.resolve(this.root, literal);
            else if (configuredRoot !== UNKNOWN && configuredRoot.getText() === '__dirname' && !read.checker.getSymbolAtLocation(configuredRoot)?.valueDeclaration) root = path.dirname(configuredRoot.getSourceFile().fileName);
            else { this.unknown(registration, 'Asset templateRoot'); return; }
        }
        if (read.api(page.expression) === 'site.page') {
            const site = read.resolve(read.resolve(page.expression).expression);
            const shared = read.property(site.arguments[0], 'css');
            const names = shared === undefined ? [] : read.elements(shared).map(item => read.text(item));
            this.assetFields(page.arguments[1], page, root, ['template']);
            if (names.includes(UNKNOWN)) this.unknown(site, 'Shared stylesheet provenance');
            else this.assetFields(page.arguments[1], page, root, ['css'], new Set(names));
            this.assetFields(site.arguments[0], site, root, ['css']);
        } else this.assetFields(page.arguments[1], page, root);
    }

    assetFields(options, declaration, explicitRoot, fields = ['css', 'template'], skip = new Set()) {
        const read = this.syntax;
        for (const field of fields) {
            const expression = read.property(options, field);
            if (expression === undefined) continue;
            for (const item of read.elements(expression)) {
                const file = read.text(item);
                if (file === UNKNOWN) { this.unknown(declaration, `Page ${field}`); continue; }
                if (skip.has(file)) continue;
                const root = explicitRoot || path.dirname(declaration.getSourceFile().fileName);
                const resolved = path.resolve(root, file);
                if (outside(root, resolved)) {
                    this.finding('ASSET_OUTSIDE_ROOT', declaration, `Page ${field} "${file}" escapes its asset root.`, 'Keep assets within the page directory or the explicit templateRoot.');
                    continue;
                }
                try {
                    if (outside(fs.realpathSync(root), fs.realpathSync(resolved))) {
                        this.finding('ASSET_OUTSIDE_ROOT', declaration, `Page ${field} "${file}" resolves through a link outside its asset root.`, 'Use an asset within the configured root.');
                    } else if (!fs.statSync(resolved).isFile()) {
                        this.finding('ASSET_NOT_FILE', declaration, `Page ${field} "${file}" is not a file.`, 'Point this declaration to a CSS or HTML file.');
                    } else if (field === 'template' && fs.statSync(resolved).size <= 1024 * 1024) {
                        this.actions.markup(declaration.parent.parent, fs.readFileSync(resolved, 'utf8'), declaration, resolved);
                    } else if (field === 'template') this.actions.unknown(declaration, 'HTML action inspection exceeds the 1 MiB per-template limit.');
                } catch (error) {
                    this.finding('ASSET_UNAVAILABLE', declaration, `Page ${field} "${file}" is unavailable (${error.code}).`, 'Create/correct the asset at its source root and include it in the production asset-copy step.');
                }
            }
        }
    }
}

module.exports = SourceInspector;
