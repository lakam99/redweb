'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ts = require('typescript');
const ApplicationCoverage = require('./ApplicationCoverage');

const hash = value => createHash('sha256').update(value).digest('hex');
const slash = value => value.replaceAll('\\', '/');

/** One original-source map shared by the Node and native-browser adapters. */
class ClientSourceCoverage {
    static resolveCheckout(searchPaths) {
        for (const directory of searchPaths) {
            const installed = path.join(directory, 'redweb-client');
            if (!fs.existsSync(installed)) continue;
            const root = fs.realpathSync(installed);
            assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name,
                'redweb-client', 'Resolved checkout must be the redweb-client package.');
            return root;
        }
        throw new Error('Install or npm link the matching redweb-client checkout before verification.');
    }

    static validateCheckout(root, args) {
        assert.ok(args.length === 0 || (args.length === 2 && ['--client', '--check-client'].includes(args[0])),
            'Usage: verify-client-source-coverage.js [--client|--check-client <checkout>]');
        if (args.length === 0) return false;
        assert.equal(fs.realpathSync(path.resolve(args[1])), fs.realpathSync(root),
            'Expected client checkout differs from Redweb\'s resolved client; link the matching checkout before verification.');
        return args[0] === '--check-client';
    }

    constructor(root) {
        this.root = root;
        this.inputs = {};
        this.linkage = {};
        const sources = {};
        for (const filename of this.files('src')) {
            const source = fs.readFileSync(path.join(root, filename), 'utf8');
            this.inputs[filename] = hash(source);
            if (filename === 'src/types.ts' || filename === 'src/index.ts') {
                const original = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
                assert.ok(original.parseDiagnostics.length === 0 && original.statements.every(node =>
                    ts.isExportDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)),
                `${filename} is no longer erased declarations/static export linkage`);
                const emitted = ts.transpileModule(source, { compilerOptions: {
                    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
                } }).outputText;
                const ast = ts.createSourceFile(filename + '.js', emitted, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
                assert.ok(ast.statements.every(node => ts.isExportDeclaration(node)),
                    `${filename} is no longer erased declarations/static export linkage`);
                this.linkage[filename] = { sourceSha256: hash(source), emittedSha256: hash(emitted),
                    classification: filename.endsWith('/types.ts') ? 'erased declarations' : 'static export linkage' };
            } else sources[filename] = source;
        }
        this.coverage = new ApplicationCoverage(sources, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
        this.tests = this.files('tests').filter(filename => /\.(test|spec)\.[cm]?[jt]sx?$/.test(filename));
        assert.ok(this.tests.length, 'Client source coverage requires tests');
        for (const filename of [...this.files('tests'), 'package.json', 'tsconfig.json', 'vitest.config.ts']) {
            this.inputs[filename] = hash(fs.readFileSync(path.join(root, filename)));
        }
    }

    files(directory) {
        const walk = relative => fs.readdirSync(path.join(this.root, relative), { withFileTypes: true })
            .sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
                assert.ok(!entry.isSymbolicLink(), 'Coverage inputs must not contain symlinks');
                const filename = slash(path.join(relative, entry.name));
                return entry.isDirectory() ? walk(filename) : [filename];
            });
        return walk(directory);
    }

    unchanged() {
        const current = [...this.files('src'), ...this.files('tests'), 'package.json', 'tsconfig.json', 'vitest.config.ts'].sort();
        assert.deepEqual(current, Object.keys(this.inputs).sort(), 'Client source/test inventory changed during verification');
        for (const filename of current) {
            assert.equal(hash(fs.readFileSync(path.join(this.root, filename))), this.inputs[filename],
                `Client input changed during verification: ${filename}`);
        }
    }

    outcomes(report) {
        assert.equal(report.success, true, 'Client test execution failed');
        const files = report.testResults.map(file => slash(path.relative(this.root, file.name))).sort();
        assert.deepEqual(files, [...this.tests].sort(), 'Client test inventory differs from execution');
        for (const file of report.testResults) {
            assert.ok(file.assertionResults.length, 'Client test files must execute assertions');
            assert.ok(file.assertionResults.every(test => test.status === 'passed'), 'Client tests must not fail or skip');
        }
        return report.testResults.map(file => ({ file: slash(path.relative(this.root, file.name)),
            tests: file.assertionResults.map(test => ({ name: test.fullName, status: test.status }))
                .sort((a, b) => a.name.localeCompare(b.name)) })).sort((a, b) => a.file.localeCompare(b.file));
    }

    collectWorkers(reports) {
        assert.deepEqual(reports.map(report => report.test).sort(), [...this.tests].sort(),
            'Every expected client test realm must report exactly once');
        for (const report of reports) {
            assert.ok(Object.keys(report.coverage).length, 'Client test realm did not execute instrumented source');
            this.coverage.collect(report.coverage);
        }
    }
}

module.exports = { ClientSourceCoverage, hash, slash };
