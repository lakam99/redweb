'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { verifyScript } = require('../helpers/script-coverage');
const root = path.resolve(__dirname, '../..');

test('example builder checks real TypeScript errors, skipped emission, package imports and stale output', async () => {
    const script = 'scripts/build-live-html-examples.js';
    const configuration = { compilerOptions: { target: 'ES2022', module: 'commonjs', types: [], skipLibCheck: true }, files: ['example.ts'] };
    const source = `declare function require(name: string): unknown;
export const core = require("redweb");
export const jsx = require("redweb/jsx-runtime");
export const development = require("redweb/jsx-dev-runtime");
`;
    await verifyScript({ script, testFile: __filename,
        prepare(workspace) {
            fs.mkdirSync(path.join(workspace, 'scripts'));
            fs.copyFileSync(path.join(root, script), path.join(workspace, script));
            fs.mkdirSync(path.join(workspace, 'examples/live-html'), { recursive: true });
            fs.writeFileSync(path.join(workspace, 'examples/live-html/tsconfig.json'), JSON.stringify(configuration));
            fs.writeFileSync(path.join(workspace, 'examples/live-html/example.ts'), source);
            // Copy the actual compiler, rather than replacing compiler APIs or
            // requiring a global installation outside the isolated project.
            fs.cpSync(path.dirname(require.resolve('typescript/package.json')), path.join(workspace, 'node_modules/typescript'), { recursive: true });
        },
        async exercise(workspace, run) {
            const folder = path.join(workspace, 'examples/live-html');
            const target = path.join(folder, 'example.js');
            await expect(run(['--check'])).rejects.toThrow('Generated Live HTML examples are stale');
            expect(fs.existsSync(target)).toBe(false);
            expect(await run([])).toBe('');
            const generated = fs.readFileSync(target, 'utf8');
            for (const module of ['../..', '../../jsx-runtime', '../../jsx-dev-runtime']) {
                expect(generated).toContain(`require('${module}')`);
            }
            expect(await run(['--check'])).toBe('');
            fs.writeFileSync(target, generated.replace(/\n/g, '\r\n'));
            expect(await run(['--check'])).toBe('');
            fs.writeFileSync(target, '// stale output\n');
            await expect(run(['--check'])).rejects.toThrow('Generated Live HTML examples are stale');
            expect(fs.readFileSync(target, 'utf8')).toBe('// stale output\n');
            await run([]);
            expect(fs.readFileSync(target, 'utf8')).toBe(generated);

            const configFile = path.join(folder, 'tsconfig.json');
            fs.writeFileSync(configFile, JSON.stringify({ ...configuration, compilerOptions: { ...configuration.compilerOptions, notACompilerOption: true } }));
            await expect(run([])).rejects.toThrow('Unknown compiler option');
            fs.writeFileSync(configFile, '{');
            await expect(run([])).rejects.toThrow('error TS');
            fs.writeFileSync(configFile, JSON.stringify(configuration));
            const sourceFile = path.join(folder, 'example.ts');
            fs.writeFileSync(sourceFile, 'export const invalid: number = "wrong";');
            await expect(run([])).rejects.toThrow('TS2322');
            expect(fs.readFileSync(target, 'utf8')).toBe(generated);
            fs.writeFileSync(sourceFile, source);
            fs.writeFileSync(path.join(folder, 'data.json'), '{}');
            fs.writeFileSync(configFile, JSON.stringify({ compilerOptions: { ...configuration.compilerOptions,
                declaration: true, emitDeclarationOnly: true, resolveJsonModule: true }, files: ['data.json'] }));
            await expect(run([])).rejects.toThrow('Example compilation did not emit JavaScript output');
            fs.writeFileSync(configFile, JSON.stringify({ ...configuration, compilerOptions: { ...configuration.compilerOptions, noEmit: true } }));
            await expect(run([])).rejects.toThrow('Example compilation did not emit JavaScript output');
            expect(fs.readFileSync(target, 'utf8')).toBe(generated);
            fs.writeFileSync(configFile, JSON.stringify(configuration));
            expect(await run(['--check'])).toBe('');
            for (const extension of ['mts', 'cts']) {
                fs.writeFileSync(path.join(folder, `module.${extension}`), 'export const value = 1;');
                fs.writeFileSync(configFile, JSON.stringify({ compilerOptions: { ...configuration.compilerOptions, module: 'NodeNext' }, files: [`module.${extension}`] }));
                expect(await run([])).toBe('');
                expect(fs.existsSync(path.join(folder, `module.${extension === 'mts' ? 'mjs' : 'cjs'}`))).toBe(true);
                expect(await run(['--check'])).toBe('');
            }
        },
    });
}, 240000);
