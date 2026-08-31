'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const ts = require('typescript');
const ApplicationCoverage = require('../../scripts/lib/ApplicationCoverage');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');

const root = path.resolve(__dirname, '../..');
const sourceFiles = ['counter.ts', 'cards.ts', 'components.ts', 'jsx-page.tsx'].map(name => `examples/live-html/${name}`)
    .concat('docs/snippets/room-access.tsx');
const names = sourceFiles.map(file => path.basename(file));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test.each([false, true])('standalone examples retain behavior and complete authored coverage (legacy=%s)', async legacy => {
    await new VerificationWorkspace().run(async owner => {
        const project = owner.directory;
        const output = path.join(project, 'dist');
        fs.mkdirSync(output);
        fs.mkdirSync(path.join(project, 'node_modules'));
        fs.symlinkSync(root, path.join(project, 'node_modules/redweb'), 'junction');
        const evidence = path.join(root, 'coverage/example-source', randomUUID());
        fs.mkdirSync(evidence, { recursive: true });
        const sources = Object.fromEntries(sourceFiles.map(file => {
            const filename = path.join(root, file);
            return [filename, fs.readFileSync(filename, 'utf8')];
        }));
        for (const [filename, source] of Object.entries(sources)) fs.writeFileSync(path.join(project, path.basename(filename)), source);
        const assets = fs.readdirSync(path.join(root, 'examples/live-html')).filter(name => /\.(css|html)$/.test(name));
        for (const name of assets) fs.copyFileSync(path.join(root, 'examples/live-html', name), path.join(output, name));
        const config = { extends: 'redweb/tsconfig.json', compilerOptions: {
            experimentalDecorators: legacy, outDir: 'dist', rootDir: '.',
        }, files: names };
        fs.writeFileSync(path.join(project, 'tsconfig.json'), JSON.stringify(config));
        const parsed = ts.getParsedCommandLineOfConfigFile(path.join(project, 'tsconfig.json'), {}, {
            ...ts.sys, onUnRecoverableConfigFileDiagnostic: error => { throw new Error(String(error.messageText)); },
        });
        expect(parsed.errors).toEqual([]);
        // Transpile authored paths independently of the temporary build root.
        const { rootDir, outDir, ...compilerOptions } = parsed.options;
        const coverage = new ApplicationCoverage(sources, compilerOptions);
        const inputPaths = [...Object.keys(sources), ...assets.map(name => path.join(root, 'examples/live-html', name)),
            'config/tsconfig.json', 'scripts/lib/ApplicationCoverage.js', 'tests/integration/live-html.integration.test.js',
            'tests/fixtures/example-entrypoints.cjs', 'tests/fixtures/record-example-coverage.cjs',
            'tests/fixtures/room-source.cjs', 'scripts/lib/verify-room-example.js']
            .map(file => path.resolve(root, file));
        const inputs = () => Object.fromEntries(inputPaths.map(file => [path.relative(root, file), hash(fs.readFileSync(file))]));
        const before = inputs();
        const suites = ['tests/integration/live-html.integration.test.js', 'tests/fixtures/example-entrypoints.cjs', 'tests/fixtures/room-source.cjs'];
        const jestConfig = { ...require('../../jest.config'), rootDir: root, collectCoverage: false,
            testMatch: suites.map(file => `<rootDir>/${file}`),
            setupFilesAfterEnv: ['<rootDir>/tests/fixtures/record-example-coverage.cjs'],
            moduleNameMapper: { '^\\.\\./\\.\\./examples/live-html/(counter|cards|components|jsx-page)$': `${output.replaceAll('\\', '/')}/$1.js` },
        };
        const args = [require.resolve('jest/bin/jest'), '--config', JSON.stringify(jestConfig), '--runInBand', '--silent'];
        const expectedSuites = suites.map(file => path.join(root, file)).sort();
        const result = { passed: false, legacy, node: process.version, typescript: ts.version,
            inputs: before, config, compilerOptions,
            compiledSha256: Object.fromEntries(Object.entries(coverage.compiled).map(([file, code]) => [file, hash(code)])) };
        let failure;
        try {
            result.phase = 'build';
            result.build = await owner.command([require.resolve('typescript/bin/tsc'), '-p', project], { timeoutMs: 30000 });
            for (const mode of ['plain', 'instrumented']) {
                if (mode === 'instrumented') for (const [file, code] of Object.entries(coverage.compiled)) {
                    fs.writeFileSync(path.join(output, path.basename(file).replace(/\.tsx?$/, '.js')), code);
                }
                result.phase = mode;
                const reports = path.join(evidence, mode);
                fs.mkdirSync(reports);
                const testReport = path.join(evidence, `${mode}-tests.json`);
                result[mode] = await owner.command([...args, '--json', '--outputFile', testReport], { cwd: root, timeoutMs: 120000,
                    environment: { REDWEB_EXAMPLE_DIRECTORY: output, REDWEB_EXAMPLE_REPORTS: reports } });
                const tests = JSON.parse(fs.readFileSync(testReport, 'utf8'));
                expect(tests.success).toBe(true);
                expect(tests.numFailedTests).toBe(0);
                expect(tests.numPendingTests).toBe(0);
                expect(tests.testResults.map(suite => path.normalize(suite.name)).sort()).toEqual(expectedSuites);
                const inventory = tests.testResults.flatMap(suite => {
                    expect(suite.status).toBe('passed');
                    return suite.assertionResults.map(test => {
                        expect(test.status).toBe('passed');
                        return `${path.relative(root, suite.name)}: ${test.fullName}`;
                    });
                }).sort();
                expect(inventory.length).toBeGreaterThan(5); // Launcher units alone cannot satisfy the gate.
                result[`${mode}Inventory`] = inventory;
                if (mode === 'instrumented') expect(inventory).toEqual(result.plainInventory);
                result[`${mode}Tests`] = tests.numPassedTests;
                if (mode === 'instrumented') {
                    const files = fs.readdirSync(reports);
                    expect(files.length).toBe(suites.length);
                    for (const file of files) coverage.collect(JSON.parse(fs.readFileSync(path.join(reports, file), 'utf8')));
                }
            }
            result.phase = 'coverage';
            expect(inputs()).toEqual(before);
            coverage.assertComplete();
            result.passed = true;
        } catch (error) { failure = error; result.error = error.stack; }
        try { fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify({ ...result, ...coverage.report() }, null, 2), { flag: 'wx' }); }
        catch (error) { failure = failure ? new AggregateError([failure, error], failure.message, { cause: failure }) : error; }
        if (failure) throw failure;
    });
}, 300000);
