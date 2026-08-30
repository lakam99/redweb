'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRequire } = require('module');
const AdditionLayout = require('../../src/cli/AdditionLayout');
const { ProjectAddition } = require('../../src/cli/ProjectAddition');
const { parseArguments } = require('../../src/cli/arguments');
const configure = require('../helpers/addition-project');
const formatCommand = require('../../src/cli/formatCommand');

let workspace;
beforeEach(() => { workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-add-unit-')); configure(workspace); });
afterEach(() => { fs.rmSync(workspace, { recursive: true, force: true }); });
const write = (name, value) => fs.writeFileSync(path.join(workspace, name), typeof value === 'string' ? value : JSON.stringify(value));
const config = (options = {}, extra = {}) => write('tsconfig.json', { extends: 'redweb/tsconfig.json', compilerOptions: { rootDir: 'source', outDir: 'build', ...options }, include: ['source/**/*'], ...extra });
const add = (options = {}) => new ProjectAddition().add(workspace, { kind: 'page', name: 'hello', ...options });

test('argument parsing validates add operands, options and values', () => {
    expect(() => AdditionLayout.requireMatcher(undefined)).toThrow('file matcher');
    expect(AdditionLayout.requireMatcher(require('typescript').matchFiles)).toBe(require('typescript').matchFiles);
    expect(formatCommand(['node', "a'b $name"], 'win32')).toBe("& 'node' 'a''b $name'");
    expect(formatCommand(['node', "a'b $name"], 'linux')).toBe("'node' 'a'\\''b $name'");
    expect(parseArguments(['add', 'page', 'hello', 'project', '--config', 'build.json', '--source-dir', 'app', '--test-dir', 'checks', '--dry-run', '--json']))
        .toMatchObject({ kind: 'page', name: 'hello', target: 'project', configFile: 'build.json', sourceDir: 'app', testDir: 'checks', dryRun: true, json: true });
    for (const args of [['add'], ['add', 'unknown', 'name'], ['add', 'page', '--json'], ['add', 'page', 'hello', '--source-dir'], ['add', 'page', 'hello', '--config', '--json'], ['add', 'page', 'hello', '--existing']]) {
        expect(() => parseArguments(args)).toThrow();
    }
});

test('compiler emit diagnostics reject collisions and noEmitOnError without writing output', () => {
    config({ noEmitOnError: true });
    write('source/app.ts', 'export const broken: number = "wrong";');
    expect(() => add()).toThrow('not assignable');
    expect(fs.existsSync(path.join(workspace, 'build'))).toBe(false);
    write('source/app.ts', 'export {};');
    write('source/clash.ts', 'export {};');
    config({}, { files: ['source/clash.ts', 'source/clash.tsx'], include: [] });
    expect(() => new AdditionLayout(workspace).outputFor('source/clash.tsx', 'export {};')).toThrow('multiple input files');
    config({ module: 'CommonJS', moduleResolution: 'Node' });
    fs.unlinkSync(path.join(workspace, 'package.json'));
    expect(new AdditionLayout(workspace).outputFor('source/plain.ts', 'export {};')).toBe('build/plain.js');
});

test('refuses compiled tests and inferred output relocation; follows imports outside include', () => {
    config({ allowJs: true }, { include: ['**/*'] });
    expect(() => add()).toThrow('CJS test would enter');
    expect(fs.existsSync(path.join(workspace, 'test'))).toBe(false);
    config({ allowJs: true }, { include: ['**/*'], exclude: ['checks', 'node_modules', 'build'] });
    expect(add({ testDir: 'checks', dryRun: true }).created).toEqual([]);
    write('tsconfig.json', { extends: 'redweb/tsconfig.json', compilerOptions: { outDir: 'build', module: 'CommonJS', moduleResolution: 'Node' }, include: ['source/**/*.ts'] });
    expect(() => new AdditionLayout(workspace, { sourceDir: 'other' }).outputFor('other/new.ts', 'export {};')).toThrow('excluded');
    write('tsconfig.json', { extends: 'redweb/tsconfig.json', compilerOptions: { outDir: 'build', module: 'CommonJS', moduleResolution: 'Node' }, include: ['source/**/*.ts', 'other/**/*.ts'] });
    expect(() => new AdditionLayout(workspace, { sourceDir: 'other' }).outputFor('other/new.ts', 'export {};')).toThrow('relocate existing');
    write('source/app.ts', "import { value } from '../shared'; export { value };");
    write('shared.ts', 'export const value = 1;');
    expect(new AdditionLayout(workspace, { sourceDir: 'source' }).outputFor('source/pages/new.ts', 'export {};')).toBe('build/source/pages/new.js');
});

test('names and dependency declarations fail before files are written', () => {
    expect(() => add({ kind: 'other' })).toThrow('kind');
    for (const name of ['../escape', 'Upper', 'a'.repeat(65), 'bad--name', '']) expect(() => add({ name })).toThrow('kebab-case');
    for (const manifest of [{}, { devDependencies: { redweb: '*' } }, { dependencies: { redweb: '*' } }, { dependencies: { redweb: '*', ws: '*' } }]) {
        write('package.json', manifest);
        expect(() => add({ kind: 'socket-route' })).toThrow('explicitly declared and installed');
    }
    write('package.json', { dependencies: { redweb: '*', ws: '*', zod: '*' } });
    expect(add({ kind: 'socket-route', dryRun: true }).created).toEqual([]);
    fs.unlinkSync(path.join(workspace, 'node_modules', 'ws'));
    expect(() => add()).toThrow('ws must');
    expect(fs.existsSync(path.join(workspace, 'test'))).toBe(false);
});

test('requires an installed supported compiler and valid configuration', () => {
    fs.unlinkSync(path.join(workspace, 'node_modules', 'typescript'));
    expect(() => new AdditionLayout(workspace)).toThrow('TypeScript is missing');
    const fixture = createRequire(require.resolve('redweb-legacy-compiler-fixture/package.json'));
    fs.symlinkSync(path.dirname(fixture.resolve('typescript/package.json')), path.join(workspace, 'node_modules', 'typescript'), 'junction');
    expect(() => new AdditionLayout(workspace)).toThrow('TypeScript 5 or newer');
});

test('reports syntax and inherited configuration errors', () => {
    write('tsconfig.json', '{');
    expect(() => new AdditionLayout(workspace)).toThrow();
    write('tsconfig.json', { extends: './missing.json' });
    expect(() => new AdditionLayout(workspace)).toThrow('missing.json');
    expect(() => new AdditionLayout(workspace, { configFile: '../outside.json' })).toThrow('inside');
});

test('refuses unsupported project and emission modes', () => {
    for (const options of [{ outFile: 'all.js' }, { noEmit: true }, { emitDeclarationOnly: true }]) {
        config(options);
        expect(() => new AdditionLayout(workspace)).toThrow('single emitting');
    }
    config({}, { references: [{ path: './other' }] });
    expect(() => new AdditionLayout(workspace)).toThrow('single emitting');
    config({ module: 'ESNext' });
    expect(() => new AdditionLayout(workspace)).toThrow('Node-compatible');
    config({ module: 'CommonJS', moduleResolution: 'Bundler' });
    expect(() => new AdditionLayout(workspace)).toThrow('Node-compatible');
    write('tsconfig.json', { extends: 'redweb/tsconfig.json', include: ['source/**/*'] });
    expect(() => new AdditionLayout(workspace)).toThrow('ambiguous');
    expect(new AdditionLayout(workspace, { sourceDir: 'source' }).outputFor('source/pages/only.ts', 'export {};')).toBe('source/pages/only.js');
});

test('uses compiler common-root inference and inherited config instead of guessing src to dist', () => {
    write('base.json', { extends: 'redweb/tsconfig.json', compilerOptions: { outDir: 'build', module: 'CommonJS', moduleResolution: 'Node' }, include: ['feature/**/*.ts'] });
    write('tsconfig.json', { extends: './base.json' });
    const layout = new AdditionLayout(workspace, { sourceDir: 'feature' });
    expect(layout.outputFor('feature/deep/file.ts', 'export const value = 1;')).toBe('build/file.js');
    expect(fs.existsSync(path.join(workspace, 'feature'))).toBe(false);
    config({}, { files: ['source/app.ts'], include: [] });
    expect(() => add()).toThrow('excluded');
});

test('rejects unsafe directories, JSX mismatch and emitted module-scope mismatches', () => {
    expect(() => add({ sourceDir: '../outside' })).toThrow('inside');
    expect(() => add({ testDir: '../outside' })).toThrow('inside');
    expect(fs.existsSync(path.join(workspace, 'source/pages'))).toBe(false);
    config({ jsxImportSource: 'react' });
    expect(() => add()).toThrow('Redweb JSX');
    config({ jsx: 'preserve' });
    expect(() => add()).toThrow('Redweb JSX');
    config();
    fs.mkdirSync(path.join(workspace, 'build'));
    write('build/package.json', { type: 'module' });
    expect(() => add()).toThrow('module formats disagree');
    expect(fs.existsSync(path.join(workspace, 'source/pages'))).toBe(false);
});

test('type-checks the prospective source and refuses non-Node JSX outputs', () => {
    config({ module: 'CommonJS', moduleResolution: 'Node', verbatimModuleSyntax: true });
    expect(() => add()).toThrow();
    config();
    expect(() => new AdditionLayout(workspace).outputFor('source/bad.ts', 'export const = ;')).toThrow();
    expect(() => new AdditionLayout(workspace).outputFor('source/bad.ts', 'export const value: string = 1;')).toThrow('not assignable');
    config({ jsx: 'preserve' });
    expect(() => new AdditionLayout(workspace).outputFor('source/page.tsx', 'export const value = <h1 />;')).toThrow('one Node JavaScript');
    config({ outDir: '../outside' });
    expect(() => new AdditionLayout(workspace).outputFor('source/file.ts', 'export {};')).toThrow('inside');
});
