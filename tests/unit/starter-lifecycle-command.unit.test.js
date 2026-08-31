'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const filename = path.resolve(__dirname, '../../scripts/verify-starter-lifecycle.js');

// Explicit orchestration faults; integration uses actual c8/processes/networking.
test.each(['pass', 'import', 'crlf', 'mkdir', 'starter', 'source', 'directive', 'copy', 'command', 'read', 'write', 'log', 'changed-emission', 'malformed',
    'empty', 'wrong-file', 'extra-file', 'empty-statements', 'empty-functions', 'empty-branches',
    'uncovered-statements', 'uncovered-functions', 'uncovered-branches', 'cleanup'])
('lifecycle coordinator unit: %s', async mode => {
    const events = [], errors = [], module = { exports: {} }, processState = { execPath: process.execPath };
    const execution = { directory: path.resolve('unit-lifecycle') };
    const expected = path.join(execution.directory, 'realtime/dist/run-app.js');
    const location = { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } };
    const entry = { path: expected, statementMap: { 0: location }, s: { 0: 1 },
        fnMap: { 0: { name: 'run', decl: location, loc: location, line: 1 } }, f: { 0: 1 },
        branchMap: { 0: { type: 'if', line: 1, loc: location, locations: [location] } }, b: { 0: [1] } };
    for (const [metric, counter, map] of [['statements', 's', 'statementMap'], ['functions', 'f', 'fnMap'], ['branches', 'b', 'branchMap']]) {
        if (mode === `empty-${metric}`) { entry[counter] = {}; entry[map] = {}; }
        if (mode === `uncovered-${metric}`) entry[counter][0] = counter === 'b' ? [0] : 0;
    }
    let report = { [expected]: entry };
    if (mode === 'empty') report = {};
    if (mode === 'wrong-file') report = { 'wrong.js': { ...entry, path: 'wrong.js' } };
    if (mode === 'extra-file') report['extra.js'] = { ...entry, path: 'extra.js' };
    const fail = event => { events.push(event); if (mode === event) throw new Error(`unit ${event} failed`); };
    let emitted = mode === 'crlf' ? 'void 0;\r\n//# sourceMappingURL=run-app.js.map\r\n' : 'void 0;\n//# sourceMappingURL=run-app.js.map';
    class Workspace {
        async run(operation) {
            events.push('owned');
            try { return await operation(execution); }
            finally { fail('cleanup'); }
        }
    }
    const nativeRequire = createRequire(filename);
    const requireBoundary = name => {
        if (name === 'node:fs') return {
            mkdirSync() { fail('mkdir'); },
            copyFileSync(source, target) {
                expect(source).toMatch(/dist[\\/]run-app\.js(?:\.map)?$/);
                expect(target).toMatch(/deployed-run-app\.js(?:\.map)?$/);
                fail('copy');
            },
            readFileSync(file) {
                if (file === expected) {
                    fail('source');
                    return mode === 'directive' ? 'void 0;' : mode === 'changed-emission' && events.includes('command') ? 'changed' : emitted;
                }
                fail('read'); return mode === 'malformed' ? '{broken' : JSON.stringify(report);
            },
            writeFileSync(file, value) {
                fail(path.basename(file) === 'test-output.txt' ? 'log' : 'write');
                if (file === expected) emitted = value;
            },
        };
        if (name === './lib/VerificationWorkspace') return { VerificationWorkspace: Workspace };
        if (name === './lib/verify-starter') return { verifyStarter: async (root, owner, template) => {
            expect(owner).toBe(execution); expect(template).toBe('realtime'); fail('starter');
        } };
        if (name === './lib/reportCommand') return { reportCommand: async (owner, args, options, source, target) => {
            expect(owner).toBe(execution);
            expect(args).toContain('--include=dist/run-app.js');
            expect(args).toContain('--check-coverage');
            expect(args.slice(-3)).toEqual([process.execPath, '--test', 'test/run-app.test.cjs']);
            expect(options.cwd).toBe(path.join(execution.directory, 'realtime'));
            expect(source).toBe(path.join(options.cwd, 'coverage/lifecycle/coverage-final.json'));
            expect(target).toMatch(/starter-lifecycle[\\/][^\\/]+[\\/]coverage-final.json$/);
            fail('command'); return 'unit command output';
        } };
        return nativeRequire(name);
    };
    requireBoundary.resolve = nativeRequire.resolve;
    requireBoundary.main = mode === 'import' ? {} : module;
    const context = { module, require: requireBoundary, __dirname: path.dirname(filename), process: processState,
        console: { log(value) { events.push('success'); expect(value).toBe('unit command output'); }, error(error) { errors.push(error); } } };
    const instrumenter = createInstrumenter();
    vm.runInNewContext(instrumenter.instrumentSync(fs.readFileSync(filename, 'utf8'), filename), context, { filename });
    if (mode === 'import') {
        expect(events).toEqual([]);
        await module.exports.main();
    }
    await new Promise(resolve => setImmediate(resolve));
    if (['pass', 'import', 'crlf'].includes(mode)) {
        expect(errors).toEqual([]);
        expect(events).toEqual(['mkdir', 'owned', 'starter', 'source', 'copy', 'copy', 'write', 'write', 'command', 'log', 'source', 'read', 'cleanup', 'success']);
        expect(processState.exitCode).toBeUndefined();
        expect(emitted).toBe('void 0;');
    } else {
        expect(errors).toHaveLength(1);
        expect(processState.exitCode).toBe(1);
        expect(events).not.toContain('success');
        if (mode !== 'mkdir') expect(events).toContain('cleanup');
    }
    if (process.argv.includes('--collectCoverageFrom=scripts/verify-starter-lifecycle.js')) {
        const combined = createCoverageMap(globalThis.__coverage__ || {});
        combined.merge(context.__coverage__);
        globalThis.__coverage__ ||= {};
        globalThis.__coverage__[filename] = combined.fileCoverageFor(filename).toJSON();
    }
});
