'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { ClientSourceCoverage } = require('../../scripts/lib/ClientSourceCoverage');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');

async function fixture(operation) {
    await new VerificationWorkspace().run(async execution => {
        const root = execution.directory;
        for (const directory of ['src', 'tests']) fs.mkdirSync(path.join(root, directory));
        const files = {
            'src/feature.ts': 'export const choose = (input: boolean) => input ? 1 : 2;',
            'src/types.ts': 'export interface Options { value: string }',
            'src/index.ts': "export { choose } from './feature'; export type * from './types';",
            'tests/feature.test.ts': '// Test inventory fixture; its execution report is unit input, not integration evidence.',
            'package.json': '{}', 'tsconfig.json': '{}', 'vitest.config.ts': 'export default {};',
        };
        for (const [filename, source] of Object.entries(files)) fs.writeFileSync(path.join(root, filename), source);
        await operation(root);
    });
}

function executed(coverage) {
    const context = vm.createContext({ exports: {} });
    const javascript = ts.transpileModule(coverage.compiled['src/feature.ts'], {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInContext(javascript + '; exports.choose(true); exports.choose(false);', context);
    return JSON.parse(JSON.stringify(context.__redwebApplicationCoverage__));
}

function outcome(root) {
    return { success: true, testResults: [{ name: path.join(root, 'tests/feature.test.ts'), assertionResults: [
        { fullName: 'second unit fixture assertion', status: 'passed' },
        { fullName: 'first unit fixture assertion', status: 'passed' },
    ] }] };
}

test('inventories all modules and inputs, classifies only erased/linkage files, and collects actual VM executions', () => fixture(root => {
    const source = new ClientSourceCoverage(root);
    expect(Object.keys(source.coverage.sources)).toEqual(['src/feature.ts']);
    expect(source.linkage['src/index.ts'].classification).toBe('static export linkage');
    expect(source.linkage['src/types.ts'].classification).toBe('erased declarations');
    source.unchanged();
    expect(() => source.coverage.assertComplete()).toThrow('coverage');
    source.collectWorkers([{ test: 'tests/feature.test.ts', coverage: executed(source.coverage) }]);
    source.coverage.assertComplete();
    expect(source.outcomes(outcome(root))[0].tests[0].name).toBe('first unit fixture assertion');
}));

test('a newly added unimported executable module starts at zero instead of disappearing', () => fixture(root => {
    fs.mkdirSync(path.join(root, 'src/nested'));
    fs.writeFileSync(path.join(root, 'src/nested/unused.js'), 'export const unused = () => 42;');
    const source = new ClientSourceCoverage(root);
    source.collectWorkers([{ test: 'tests/feature.test.ts', coverage: executed(source.coverage) }]);
    expect(() => source.coverage.assertComplete()).toThrow('coverage');
    expect(source.coverage.report().coverage['src/nested/unused.js'].s).toEqual({ 0: 0, 1: 0 });
}));

test('compares multiple test files in deterministic order', () => fixture(root => {
    fs.writeFileSync(path.join(root, 'tests/another.test.js'), '// Test-inventory fixture');
    const source = new ClientSourceCoverage(root);
    const report = outcome(root);
    report.testResults.push({ name: path.join(root, 'tests/another.test.js'), assertionResults: [
        { fullName: 'another assertion', status: 'passed' },
    ] });
    expect(source.outcomes(report).map(file => file.file)).toEqual(['tests/another.test.js', 'tests/feature.test.ts']);
}));

test.each(['src/types.ts', 'src/index.ts'])('rejects executable additions to classified %s', filename => fixture(root => {
    fs.appendFileSync(path.join(root, filename), '\nconsole.log("must be measured");');
    expect(() => new ClientSourceCoverage(root)).toThrow('no longer');
}));

test.each(['export = console.log("runtime");', 'export import value = require("some-runtime");'])
('checks original syntax before TypeScript can erase an unsupported runtime export: %s', syntax => fixture(root => {
    fs.writeFileSync(path.join(root, 'src/index.ts'), syntax);
    expect(() => new ClientSourceCoverage(root)).toThrow('no longer');
}));

test('includes ordinary Vitest spec, JSX and module-extension test files in the required inventory', () => fixture(root => {
    for (const filename of ['case.spec.ts', 'jsx.test.tsx', 'module.test.mts', 'common.spec.cjs']) {
        fs.writeFileSync(path.join(root, 'tests', filename), '// Discovery fixture');
    }
    const source = new ClientSourceCoverage(root);
    expect(source.tests).toHaveLength(5);
    expect(() => source.outcomes(outcome(root))).toThrow('inventory differs');
}));

test('rejects changed content, added files, missing tests and symlinked source input', () => fixture(root => {
    const source = new ClientSourceCoverage(root);
    fs.appendFileSync(path.join(root, 'src/feature.ts'), '\n// changed');
    expect(() => source.unchanged()).toThrow('input changed');
    fs.writeFileSync(path.join(root, 'src/added.ts'), 'export const added = 1;');
    expect(() => source.unchanged()).toThrow('inventory changed');
    fs.unlinkSync(path.join(root, 'tests/feature.test.ts'));
    expect(() => new ClientSourceCoverage(root)).toThrow('requires tests');
    fs.symlinkSync(path.join(root, 'tests'), path.join(root, 'src/linked'), 'junction');
    expect(() => new ClientSourceCoverage(root)).toThrow('symlinks');
}));

test('missing, duplicate, empty and altered worker reports cannot pass', () => fixture(root => {
    const source = new ClientSourceCoverage(root);
    const report = { test: 'tests/feature.test.ts', coverage: executed(source.coverage) };
    expect(() => source.collectWorkers([])).toThrow('exactly once');
    expect(() => source.collectWorkers([report, report])).toThrow('exactly once');
    expect(() => source.collectWorkers([{ ...report, coverage: {} }])).toThrow('did not execute');
    report.coverage['src/feature.ts'].statementMap[0].start.line++;
    expect(() => source.collectWorkers([report])).toThrow('differs');
}));

test('failed, omitted and skipped test outcomes remain failures even with complete counters', () => fixture(root => {
    const source = new ClientSourceCoverage(root);
    source.coverage.collect(executed(source.coverage));
    source.coverage.assertComplete();
    expect(() => source.outcomes({ ...outcome(root), success: false })).toThrow('execution failed');
    expect(() => source.outcomes({ success: true, testResults: [] })).toThrow('inventory differs');
    const empty = outcome(root); empty.testResults[0].assertionResults = [];
    expect(() => source.outcomes(empty)).toThrow('execute assertions');
    const skipped = outcome(root); skipped.testResults[0].assertionResults[0].status = 'pending';
    expect(() => source.outcomes(skipped)).toThrow('must not fail or skip');
}));
