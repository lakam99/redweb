'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const filename = path.resolve(__dirname, '../../scripts/verify-browser-coverage.js');
const leaves = error => Array.isArray(error?.errors) ? error.errors.flatMap(leaves) : [error];

// Explicit report/dependency boundary units, not mocked browser integration.
async function exercise({ point, value, primary, mode = 'runtime', cli = false, malformed } = {}) {
    const stored = new Map(), printed = [], errors = [];
    let fired = false;
    const fail = name => {
        if (!fired && name === point) { fired = true; throw value; }
    };
    const nativeRequire = createRequire(filename);
    let bundle = fs.readFileSync(path.join(path.dirname(require.resolve('redweb-client/live-html')), 'live-html.js'), 'utf8');
    if (malformed === 'modules') bundle += '\n// src/unknown.js';
    if (malformed === 'exports') bundle += '\nconsole.log("after exports");';
    const requireBoundary = name => {
        if (name === 'node:fs') return {
            readFileSync: () => bundle,
            mkdirSync() { fail('mkdir'); },
            writeFileSync(file, text) { fail(file.endsWith('report.json') ? 'report' : 'source'); stored.set(file, text); },
        };
        if (name === './lib/BrowserCoverage') return class {
            constructor(name, source) { this.filename = name; this.source = source; }
            async verify() { return { failure: primary, report: { status: primary ? 'failed' : 'passed', retainedWorkspace: primary?.retainedWorkspace } }; }
        };
        return nativeRequire(name);
    };
    requireBoundary.resolve = nativeRequire.resolve;
    const context = { require: requireBoundary, module: { exports: {} }, __dirname: path.dirname(filename),
        process: { argv: cli ? ['node', filename, mode] : ['node', filename], env: {}, exitCode: 0 },
        console: { log(value) { fail('log'); printed.push(value); }, error(error) { errors.push(error); } }, URL };
    if (cli) requireBoundary.main = context.module;
    vm.runInNewContext(createInstrumenter().instrumentSync(fs.readFileSync(filename, 'utf8'), filename), context, { filename });
    let rejected = false, result;
    if (cli) { await new Promise(resolve => setImmediate(resolve)); result = errors[0]; rejected = context.process.exitCode === 1; }
    else try { await context.module.exports.main(mode === 'default' ? undefined : mode); }
    catch (error) { rejected = true; result = error; }
    if (process.argv.includes('--collectCoverageFrom=scripts/verify-browser-coverage.js')) {
        const map = createCoverageMap(globalThis.__coverage__ || {}); map.merge(context.__coverage__);
        globalThis.__coverage__ ||= {}; globalThis.__coverage__[filename] = map.fileCoverageFor(filename).toJSON();
    }
    const text = [...stored.entries()].find(([file]) => file.endsWith('report.json'))?.[1];
    return { rejected, result, report: text && JSON.parse(text), printed, context };
}

test.each(['mkdir', 'source', 'report', 'log'])('terminal %s failure corrects retained status and preserves workspace identity', async point => {
    const primary = Object.assign(new Error('unit browser failure'), { retainedWorkspace: 'unit-retained-profile' });
    const cleanup = new Error('unit report failure');
    const result = await exercise({ point, value: cleanup, primary });
    expect(result.rejected).toBe(true);
    expect(leaves(result.result)).toEqual([primary, cleanup]);
    expect(result.result.retainedWorkspace).toBe(primary.retainedWorkspace);
    expect(result.report.status).toBe('failed');
    expect(result.report.retainedWorkspace).toBe(primary.retainedWorkspace);
});

test.each([undefined, null, false, 0, '', new Error('unit log failure')])
('late publication failure cannot leave a passed report: %p', async value => {
    const result = await exercise({ point: 'log', value });
    expect(result.rejected).toBe(true);
    expect(require('node:util').types.isNativeError(result.result)).toBe(true);
    expect(result.report.status).toBe('failed');
    expect(result.report.error).toBe(result.result.message);
});

test.each(['runtime', 'refresh', 'client', 'default'])('main selects the intended %s source', async mode => {
    const result = await exercise({ mode });
    expect(result.rejected).toBe(false);
    expect(result.report.status).toBe('passed');
    expect(result.printed).toHaveLength(1);
    expect(Boolean(result.report.bundleSha256)).toBe(mode === 'runtime' || mode === 'default');
});

test.each(['modules', 'exports'])('rejects a changed runtime %s boundary before publication', async malformed => {
    const result = await exercise({ malformed });
    expect(result.rejected).toBe(true);
    expect(result.result.message).toMatch(malformed === 'modules' ? /Every bundled module/ : /Only static export linkage/);
    expect(result.report).toBeUndefined();
});

test('an invalid CLI mode exits unsuccessfully without publishing a report', async () => {
    const result = await exercise({ mode: 'invalid', cli: true });
    expect(result.rejected).toBe(true);
    expect(result.result.message).toContain('Expected runtime, refresh or client');
    expect(result.report).toBeUndefined();
});
