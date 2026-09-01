'use strict';

const fs = require('fs');
const path = require('path');
const { resolveDependency, readConfig } = require('./ProjectConfig');
const { assertSafePath } = require('./FilePlan');

/** Read TypeScript's effective layout without evaluating application modules. */
class AdditionLayout {
    constructor(root, { configFile = 'tsconfig.json', sourceDir } = {}) {
        this.root = root;
        this.configFile = configFile;
        assertSafePath(path.resolve(root, configFile), root);
        const compiler = resolveDependency(root, 'typescript');
        if (!compiler) throw new Error('TypeScript is missing. Run npm install --save-dev typescript.');
        this.ts = require(compiler);
        if (Number(this.ts.version.split('.')[0]) < 5) throw new Error('Add requires TypeScript 5 or newer.');
        this.config = this.read();
        const options = this.config.options;
        if (this.config.projectReferences?.length || options.outFile || options.noEmit || options.emitDeclarationOnly) {
            throw new Error('Select a single emitting TypeScript project with --config; project references, outFile and disabled JavaScript emission are unsupported.');
        }
        const { ModuleKind, ModuleResolutionKind } = this.ts;
        if (![ModuleKind.CommonJS, ModuleKind.Node16, ModuleKind.NodeNext].includes(options.module) ||
            options.moduleResolution === ModuleResolutionKind.Bundler) {
            throw new Error('Add requires Node-compatible TypeScript emission (CommonJS, Node16 or NodeNext), not a custom bundler.');
        }
        if (!options.rootDir && !sourceDir) throw new Error('Source layout is ambiguous. Set rootDir or pass --source-dir relative to the project.');
        this.sourceDir = path.resolve(root, sourceDir || options.rootDir);
        assertSafePath(path.join(this.sourceDir, '__redweb_source_check.ts'), root);
    }

    read(host = this.ts.sys) {
        const { config, syntaxError } = readConfig(this.ts, this.root, this.configFile, host);
        const errors = syntaxError ? [syntaxError] : config.errors.filter(error => error.code !== 18003);
        if (errors.length) throw new Error(errors.map(error => this.ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
        return config;
    }

    prospective(filename) {
        const { ts, root } = this;
        // TypeScript owns include/exclude glob semantics. Its runtime matcher is
        // version-checked rather than approximated with a second glob language.
        const matchFiles = requireMatcher(ts.matchFiles);
        const absolute = path.resolve(root, filename).replaceAll('\\', '/');
        const virtualDirectories = new Map();
        for (let current = absolute; path.dirname(current) !== current; current = path.dirname(current)) {
            virtualDirectories.set(path.dirname(current), current);
        }
        const host = {
            ...ts.sys,
            readDirectory: (directory, extensions, excludes, includes, depth) => [...new Set([
                ...ts.sys.readDirectory(directory, extensions, excludes, includes, depth),
                ...matchFiles(directory, extensions, excludes, includes, ts.sys.useCaseSensitiveFileNames, root, depth,
                    entry => {
                        const added = virtualDirectories.get(path.resolve(entry).replaceAll('\\', '/'));
                        return { files: added === absolute ? [path.basename(added)] : [],
                            directories: added && added !== absolute ? [path.basename(added)] : [] };
                    }, ts.sys.realpath),
            ])],
        };
        const config = this.read(host);
        return { config, absolute, virtualDirectories };
    }

    includes(filename) {
        const { config, absolute } = this.prospective(filename);
        return config.fileNames.some(value => path.resolve(value) === path.resolve(absolute));
    }

    outputFor(filename, content) {
        const { ts, root } = this;
        const { config, absolute, virtualDirectories } = this.prospective(filename);
        if (!config.fileNames.some(value => path.resolve(value) === path.resolve(absolute))) {
            throw new Error(`${filename} is excluded from ${this.configFile}. Adjust the configuration yourself or choose --source-dir.`);
        }
        // Compiler options and syntactic diagnostics require no application execution.
        const compilerHost = ts.createCompilerHost(config.options);
        const readSource = compilerHost.readFile;
        const fileExists = compilerHost.fileExists;
        const directoryExists = compilerHost.directoryExists;
        compilerHost.getCurrentDirectory = () => root;
        compilerHost.readFile = name => path.resolve(name) === path.resolve(absolute) ? content : readSource(name);
        compilerHost.fileExists = name => path.resolve(name) === path.resolve(absolute) || fileExists(name);
        compilerHost.directoryExists = name => virtualDirectories.has(path.resolve(name).replaceAll('\\', '/')) || directoryExists(name);
        const program = ts.createProgram(config.fileNames, config.options, compilerHost);
        const sourceFile = program.getSourceFile(absolute);
        const errors = [...program.getOptionsDiagnostics(), ...program.getSyntacticDiagnostics(sourceFile), ...program.getSemanticDiagnostics(sourceFile)];
        if (errors.length) throw new Error(errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
        const emitted = emissionMap(ts, program);
        const output = emitted.get(absolute);
        if (!output) throw new Error('Expected one Node JavaScript output for the new source file.');
        assertSafePath(path.resolve(output), root);
        if (!config.options.rootDir) {
            const previousHost = ts.createCompilerHost(this.config.options);
            previousHost.getCurrentDirectory = () => root;
            const previous = ts.createProgram(this.config.fileNames, this.config.options, previousHost);
            for (const [file, previousOutput] of emissionMap(ts, previous)) {
                if (emitted.get(file) !== previousOutput) {
                    throw new Error('Adding this source would relocate existing compiled files. Set an explicit rootDir before adding it.');
                }
            }
        }
        const emittedModule = [ts.ModuleKind.Node16, ts.ModuleKind.NodeNext].includes(config.options.module)
            ? sourceFile.impliedNodeFormat === ts.ModuleKind.ESNext : false;
        if (packageIsModule(path.dirname(output)) !== emittedModule) {
            throw new Error('Source and output module formats disagree with package.json type. Fix the layout; add does not copy or rewrite package manifests.');
        }
        return path.relative(root, output).replaceAll('\\', '/');
    }
}

function emissionMap(ts, program) {
    const outputs = new Map();
    const result = program.emit(undefined, (filename, _text, _bom, _error, sources) => {
        if (!/\.[cm]?js$/.test(filename)) return;
        for (const source of sources) {
            const name = path.resolve(source.fileName).replaceAll('\\', '/');
            outputs.set(name, filename);
        }
    });
    if (result.diagnostics.length) throw new Error(result.diagnostics.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
    return outputs;
}

function requireMatcher(matcher) {
    if (typeof matcher !== 'function') throw new Error('This TypeScript compiler lacks the file matcher needed for a safe preview.');
    return matcher;
}

function packageIsModule(directory) {
    for (let current = directory; ; current = path.dirname(current)) {
        const manifest = path.join(current, 'package.json');
        if (fs.existsSync(manifest)) return JSON.parse(fs.readFileSync(manifest, 'utf8')).type === 'module';
        if (path.dirname(current) === current) return false;
    }
}

module.exports = AdditionLayout;
module.exports.requireMatcher = requireMatcher;
