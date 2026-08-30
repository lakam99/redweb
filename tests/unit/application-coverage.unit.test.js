'use strict';

const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const ApplicationCoverage = require('../../scripts/lib/ApplicationCoverage');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');

const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS };
const source = 'export const choose = (value: boolean): number => value ? 1 : 2;';
function execute(coverage, filename, exercise = '') {
    const context = vm.createContext({ exports: {} });
    vm.runInContext(coverage.compiled[filename] + exercise, context);
    return JSON.parse(JSON.stringify(context.__redwebApplicationCoverage__));
}

test('seeds every original module, including ones never loaded, and merges real executions', () => {
    const coverage = new ApplicationCoverage({ 'first.ts': source, 'unused.ts': source }, options);
    expect(coverage.report().summary.statements.pct).toBe(0);
    expect(() => coverage.assertComplete()).toThrow('lines');
    coverage.collect(execute(coverage, 'first.ts', 'exports.choose(true); exports.choose(false);'));
    expect(() => coverage.assertComplete()).toThrow('lines');
    coverage.collect(execute(coverage, 'unused.ts', 'exports.choose(true);'));
    expect(() => coverage.assertComplete()).toThrow('branches');
    coverage.collect(execute(coverage, 'unused.ts', 'exports.choose(false);'));
    coverage.assertComplete();
    expect(Object.keys(coverage.report().sources)).toEqual(['first.ts', 'unused.ts']);
    expect(coverage.report().summary.functions.total).toBe(2);
});

test('original decorators, parameter properties and optional chaining retain behavior without synthetic function counts', () => {
    const original = `
        function mark(value: any, _context: any) { return value; }
        @mark export class Example {
            @mark value: number = 1;
            constructor(public prefix = 'default') {}
            choose(input?: { value?: string }) { return input?.value ?? this.prefix; }
        }
    `;
    const coverage = new ApplicationCoverage({ 'decorated.ts': original }, options);
    const plain = ts.transpileModule(original, { fileName: 'decorated.ts', compilerOptions: options }).outputText;
    const exercise = `
        const first = new exports.Example();
        const second = new exports.Example('other');
        first.value = 2;
        globalThis.result = [first.value, first.choose(), first.choose({}), second.choose({ value: 'supplied' }), second.prefix];
    `;
    const results = [plain, coverage.compiled['decorated.ts']].map(compiled => {
        const context = vm.createContext({ exports: {} });
        vm.runInContext(compiled + exercise, context);
        if (context.__redwebApplicationCoverage__) coverage.collect(JSON.parse(JSON.stringify(context.__redwebApplicationCoverage__)));
        return Array.from(context.result);
    });
    expect(results[0]).toEqual([2, 'default', 'default', 'supplied', 'other']);
    expect(results[1]).toEqual(results[0]);
    coverage.assertComplete();
    expect(coverage.report().summary.functions.total).toBe(3);
    // Istanbul counts ?? and the default argument here, not ?. as an independent branch.
    expect(Object.values(coverage.report().coverage['decorated.ts'].branchMap).map(branch => branch.type))
        .toEqual(['default-arg', 'binary-expr']);
});

test('rejects exclusions, empty source sets/modules and incompatible compilation options', () => {
    expect(() => new ApplicationCoverage({}, options)).toThrow('source modules');
    expect(() => new ApplicationCoverage({ 'empty.ts': '// no code' }, options)).toThrow('executable');
    expect(() => new ApplicationCoverage({ 'ignored.ts': '/* istanbul ignore next */ export const value = 1;' }, options)).toThrow('exclusions');
    expect(() => new ApplicationCoverage({ 'invalid.ts': source }, { ...options, moduleResolution: ts.ModuleResolutionKind.NodeNext }))
        .toThrow('diagnostics');
});

test('rejects wrong source maps, paths, counters and invalid counts before merging any entry', () => {
    const coverage = new ApplicationCoverage({ 'fixture.ts': source }, options);
    const actual = execute(coverage, 'fixture.ts', 'exports.choose(true); exports.choose(false);');
    expect(() => coverage.collect({ extra: actual['fixture.ts'] })).toThrow('Unexpected');
    const mutations = [
        value => { value.path = 'wrong.ts'; },
        ...['statementMap', 'fnMap', 'branchMap'].map(field => value => { value[field] = {}; }),
        ...['s', 'f', 'b'].map(field => value => { value[field].extra = 0; }),
        value => { value.b[0] = 1; },
        value => { value.b[0] = []; },
        ...[-1, 1.5, NaN, Infinity, '1', Number.MAX_SAFE_INTEGER + 1].map(count => value => { value.s[0] = count; }),
    ];
    for (const mutate of mutations) {
        const changed = JSON.parse(JSON.stringify(actual));
        mutate(changed['fixture.ts']);
        expect(() => coverage.collect(changed)).toThrow();
        expect(coverage.report().summary.statements.pct).toBe(0);
    }
    coverage.collect(actual);
    coverage.assertComplete();
});

test('preload collects independent real processes on natural, explicit and error exits', async () => {
    await new VerificationWorkspace().run(async execution => {
        const filename = path.join(execution.directory, 'fixture.ts');
        const coverage = new ApplicationCoverage({ [filename]: source }, options);
        const preload = path.resolve(__dirname, '../../scripts/lib/record-application-coverage.cjs');
        fs.writeFileSync(path.join(execution.directory, 'fixture.js'), coverage.compiled[filename]);
        const environment = { REDWEB_APPLICATION_COVERAGE_DIRECTORY: execution.directory };
        for (const ending of ['', 'process.exit(0);', 'throw Error("actual failure");']) {
            const command = execution.command(['--require', preload, '-e',
                `const { choose } = require('./fixture.js'); choose(true); choose(false); ${ending}`], { environment });
            if (ending.startsWith('throw')) await expect(command).rejects.toThrow('actual failure');
            else await command;
        }
        await execution.command(['--require', preload, '-e', ''], { environment });
        const reports = fs.readdirSync(execution.directory).filter(name => name.endsWith('.json'));
        expect(reports).toHaveLength(3);
        for (const report of reports) coverage.collect(JSON.parse(fs.readFileSync(path.join(execution.directory, report))));
        coverage.assertComplete();
        await expect(execution.command(['--require', preload, '-e', "require('./fixture.js')"], {
            environment: { REDWEB_APPLICATION_COVERAGE_DIRECTORY: path.join(execution.directory, 'absent') },
        })).rejects.toThrow('ENOENT');
    });
}, 15000);
