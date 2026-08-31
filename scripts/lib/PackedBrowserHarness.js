'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const harnessPaths = [
    'scripts/verify-live-html-browser.js', 'scripts/verify-browser-coverage.js', 'scripts/evaluation/process.js',
    ...['verify-action-feedback', 'verify-dashboard-browser', 'verify-starter', 'VerificationWorkspace',
        'verificationError', 'BrowserCoverage', 'BrowserPages', 'verify-runtime-browser', 'verify-refresh-coverage',
        'verify-refresh-controls', 'verify-live-page-ownership'].map(name => `scripts/lib/${name}.js`),
    'tests/helpers/network.js',
    ...['reactive-pages', 'action-page', 'feedback-page', 'selection-page', 'browser-morph-cases',
        'browser-feedback-cases', 'BrowserClientPeer', 'client-protocol-cases', 'browser-client-cases']
        .map(name => `tests/fixtures/${name}.js`),
];
const toolNames = ['c8', 'redweb-dashboard-types', 'istanbul-lib-instrument', 'istanbul-lib-coverage'];
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function snapshot(root, relative = '', output = {}) {
    for (const name of fs.readdirSync(path.join(root, relative))) {
        const file = path.join(relative, name);
        // Runtime dependencies are independently checked by ClientCandidate.
        if (file === 'node_modules') continue;
        const stat = fs.lstatSync(path.join(root, file));
        assert.ok(!stat.isSymbolicLink(), `Unexpected linked verification input: ${file}`);
        if (stat.isDirectory()) snapshot(root, file, output);
        else output[file] = hash(path.join(root, file));
    }
    return output;
}

/** Adds unchanged test inputs, never runtime replacements, to an extracted package. */
class PackedBrowserHarness {
    constructor(packageRoot, sourceRoot) {
        this.root = fs.realpathSync(packageRoot);
        this.original = snapshot(packageRoot);
        this.runtime = this.runtimePaths();
        for (const relative of harnessPaths) {
            assert.ok(!fs.existsSync(path.join(packageRoot, relative)), `Harness destination already exists: ${relative}`);
            assert.ok(fs.lstatSync(path.join(sourceRoot, relative)).isFile(), `Harness input must be a regular file: ${relative}`);
        }
        const tools = toolNames.map(name => {
            const target = path.join(packageRoot, 'node_modules', name);
            assert.ok(!fs.existsSync(target), `Verification tool already exists: ${name}`);
            return [target, path.dirname(require.resolve(`${name}/package.json`))];
        });
        this.inputs = {};
        for (const relative of harnessPaths) {
            const destination = path.join(packageRoot, relative);
            const expected = hash(path.join(sourceRoot, relative));
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(path.join(sourceRoot, relative), destination, fs.constants.COPYFILE_EXCL);
            assert.equal(hash(destination), expected);
            this.inputs[relative] = expected;
        }
        // Tools are linked individually. Never overlay runtime dependencies with
        // the development repository's node_modules or replace installed tools.
        for (const [target, source] of tools) fs.symlinkSync(source, target, 'junction');
    }

    runtimePaths() {
        const dependencies = fs.realpathSync(path.join(this.root, 'node_modules'));
        return Object.fromEntries(['redweb-client', 'redweb-client/live-html', 'ws', 'express', 'zod'].map(name => {
            const resolved = fs.realpathSync(require.resolve(name, { paths: [this.root] }));
            const relative = path.relative(dependencies, resolved);
            assert.ok(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
                `Runtime dependency escaped the isolated consumer: ${name}`);
            return [name, resolved];
        }));
    }

    verify() {
        assert.deepEqual(this.runtimePaths(), this.runtime, 'Runtime dependency resolution changed');
        for (const [file, digest] of Object.entries({ ...this.original, ...this.inputs })) {
            const input = path.join(this.root, file);
            assert.ok(fs.lstatSync(input).isFile() && fs.realpathSync(input) === input,
                `Packed verification input must remain an owned regular file: ${file}`);
            assert.equal(hash(input), digest, `Packed verification input changed: ${file}`);
        }
        return { packageFiles: Object.keys(this.original).length, harnessFiles: Object.keys(this.inputs).length,
            harnessSha256: createHash('sha256').update(JSON.stringify(this.inputs)).digest('hex'), tools: toolNames };
    }
}

module.exports = { PackedBrowserHarness };
