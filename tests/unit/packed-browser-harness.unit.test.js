'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const ts = require('typescript');
const { PackedBrowserHarness } = require('../../scripts/lib/PackedBrowserHarness');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');

const sourceRoot = path.resolve(__dirname, '../..');

// Filesystem/provenance units. The package gate separately executes real npm
// artifacts, HTTP/WebSockets and Chromium; these synthetic modules are not IT.
async function fixture(operation) {
    await new VerificationWorkspace().run(async execution => {
        const root = path.join(execution.directory, 'package');
        const dependencies = path.join(execution.directory, 'dependencies');
        fs.mkdirSync(path.join(root, 'src'), { recursive: true });
        fs.mkdirSync(dependencies);
        fs.writeFileSync(path.join(root, 'src/runtime.js'), '// runtime');
        fs.symlinkSync(dependencies, path.join(root, 'node_modules'), 'junction');
        for (const name of ['redweb-client', 'ws', 'express', 'zod']) {
            fs.mkdirSync(path.join(dependencies, name));
            fs.writeFileSync(path.join(dependencies, name, 'package.json'), JSON.stringify({ name, main: 'index.js' }));
            fs.writeFileSync(path.join(dependencies, name, 'index.js'), '// resolution fixture');
        }
        fs.writeFileSync(path.join(dependencies, 'redweb-client/live-html.js'), '// frontend resolution fixture');
        await operation({ root, dependencies, directory: execution.directory });
    });
}

test('copies the unchanged required harness, preserves package bytes and isolates runtime resolution', () => fixture(({ root, dependencies }) => {
    const harness = new PackedBrowserHarness(root, sourceRoot);
    const report = harness.verify();
    expect(report.packageFiles).toBe(1);
    expect(report.harnessFiles).toBe(27);
    expect(report.harnessSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.readFileSync(path.join(root, 'scripts/verify-live-html-browser.js')))
        .toEqual(fs.readFileSync(path.join(sourceRoot, 'scripts/verify-live-html-browser.js')));
    for (const name of report.tools) expect(fs.lstatSync(path.join(dependencies, name)).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(root, 'scripts/verify-soak.js'))).toBe(false);
}));

test('every literal relative harness dependency resolves inside the copied input set', () => fixture(({ root }) => {
    const harness = new PackedBrowserHarness(root, sourceRoot);
    for (const relative of Object.keys(harness.inputs)) {
        const filename = path.join(root, relative);
        const parsed = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
        const inspect = node => {
            if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require' &&
                node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
                const specifier = node.arguments[0].text;
                const target = path.relative(root, path.resolve(path.dirname(filename), specifier));
                if (specifier.startsWith('.') && /^(scripts|tests)[\\/]/.test(target)) {
                    const resolved = createRequire(filename).resolve(specifier);
                    expect(Object.hasOwn(harness.inputs, path.relative(root, resolved).replaceAll('\\', '/'))).toBe(true);
                }
            }
            ts.forEachChild(node, inspect);
        };
        inspect(parsed);
    }
}));

test.each(['src/runtime.js', 'tests/fixtures/feedback-page.js'])(
    'rejects changed package or harness bytes: %s', file => fixture(({ root }) => {
        const harness = new PackedBrowserHarness(root, sourceRoot);
        fs.appendFileSync(path.join(root, file), '\n// changed');
        expect(() => harness.verify()).toThrow('Packed verification input changed');
    }));

test('preflights every destination before adding any harness files', () => fixture(({ root }) => {
    fs.mkdirSync(path.join(root, 'tests/fixtures'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tests/fixtures/browser-client-cases.js'), 'existing');
    expect(() => new PackedBrowserHarness(root, sourceRoot)).toThrow('Harness destination already exists');
    expect(fs.existsSync(path.join(root, 'scripts'))).toBe(false);
}));

test('does not replace existing development tools or partly copy a harness', () => fixture(({ root, dependencies }) => {
    fs.mkdirSync(path.join(dependencies, 'c8'));
    expect(() => new PackedBrowserHarness(root, sourceRoot)).toThrow('Verification tool already exists');
    expect(fs.existsSync(path.join(root, 'scripts'))).toBe(false);
}));

test('rejects a linked package input', () => fixture(({ root, directory }) => {
    const outside = path.join(directory, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(root, 'src/linked'), 'junction');
    expect(() => new PackedBrowserHarness(root, sourceRoot)).toThrow('Unexpected linked verification input');
}));

test.each([false, true])('rejects escaped runtime resolution, staged=%s', staged => fixture(({ root, dependencies, directory }) => {
    const harness = staged ? new PackedBrowserHarness(root, sourceRoot) : undefined;
    const outside = path.join(directory, 'outside-ws');
    fs.renameSync(path.join(dependencies, 'ws'), outside);
    fs.symlinkSync(outside, path.join(dependencies, 'ws'), 'junction');
    expect(() => staged ? harness.verify() : new PackedBrowserHarness(root, sourceRoot)).toThrow('Runtime dependency escaped');
    expect(fs.existsSync(path.join(root, 'scripts'))).toBe(staged);
}));

test('rejects non-file harness inputs before staging', () => fixture(({ root, directory }) => {
    const invalid = path.join(directory, 'invalid-input');
    fs.mkdirSync(path.join(invalid, 'scripts/verify-live-html-browser.js'), { recursive: true });
    expect(() => new PackedBrowserHarness(root, invalid)).toThrow('Harness input must be a regular file');
    expect(fs.existsSync(path.join(root, 'scripts'))).toBe(false);
}));

test.each(['src', 'scripts/lib'])('rejects identical bytes reached through a replaced %s directory', relative => fixture(({ root, directory }) => {
    const harness = new PackedBrowserHarness(root, sourceRoot);
    const outside = path.join(directory, 'outside-inputs');
    fs.renameSync(path.join(root, relative), outside);
    fs.symlinkSync(outside, path.join(root, relative), 'junction');
    expect(() => harness.verify()).toThrow('must remain an owned regular file');
}));
