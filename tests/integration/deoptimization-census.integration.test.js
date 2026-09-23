'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { workerFlags } = require('../../scripts/diagnostics/recovery-split.cjs');
const { summarize } = require('../../scripts/diagnostics/recovery-code-summary.cjs');

test('real V8 deoptimization records preserve dependency invalidation and eager bailout as different kinds', () =>
    new VerificationWorkspace().run(async workspace => {
        if (Number(process.versions.node.split('.')[0]) < 20) {
            const outputRoot = path.resolve(__dirname, '../../coverage');
            const before = fs.existsSync(outputRoot) ? fs.readdirSync(outputRoot).sort() : [];
            await expect(workspace.command([path.resolve(__dirname, '../../scripts/diagnostics/recovery-split.cjs'), 'client-deopt']))
                .rejects.toThrow('Code logging requires Node 20');
            expect(fs.readdirSync(workspace.directory)).toEqual([]);
            expect(fs.existsSync(outputRoot) ? fs.readdirSync(outputRoot).sort() : []).toEqual(before);
            return;
        }
        const workerPath = path.resolve(__dirname, '../../scripts/diagnostics/recovery-split-worker.cjs');
        // Test-only native intrinsics make an actual optimized function deopt.
        // These flags/forced optimization never enter the measured workload.
        const fixture = `
            const fs = require('node:fs');
            const vm = require('node:vm');
            const source = fs.readFileSync(${JSON.stringify(workerPath)}, 'utf8');
            const markers = source.match(/function rwDiagnostic(?:Warm|Final)Boundary\\(\\) \\{ return 0; \\}/g);
            vm.runInThisContext(markers.join('\\n') + '\\n' + ${JSON.stringify(`
                rwDiagnosticWarmBoundary();
                function rwDeoptFixture(object) { return object.value + 1; }
                %PrepareFunctionForOptimization(rwDeoptFixture);
                const shape = { value: 1 };
                rwDeoptFixture(shape); rwDeoptFixture(shape);
                %OptimizeFunctionOnNextCall(rwDeoptFixture);
                if (rwDeoptFixture(shape) !== 2) throw new Error('Bad optimized result');
                shape.value = 2; // invalidates a field-const dependency
                %PrepareFunctionForOptimization(rwDeoptFixture);
                rwDeoptFixture(shape); rwDeoptFixture(shape);
                %OptimizeFunctionOnNextCall(rwDeoptFixture);
                rwDeoptFixture(shape);
                if (rwDeoptFixture({ other: 0, value: 3 }) !== 4) throw new Error('Bad bailout result');
                rwDiagnosticFinalBoundary();
            `)}, { filename: ${JSON.stringify(workerPath)} });`;
        const log = await workspace.command([...workerFlags('client', 'client-deopt'), '--allow-natives-syntax', '-e', fixture],
            { timeoutMs: 10000, environment: { NODE_OPTIONS: '', NODE_V8_COVERAGE: '' } });
        expect(/^(script-source|code-source-info|code-disassemble|feedback-vector),/m.test(log)).toBe(false);
        if (process.versions.v8 === '12.4.254.21-node.33') {
            const report = summarize(log);
            const rows = report.deoptimizations.rows.filter(row => row.name === 'rwDeoptFixture');
            expect(rows.some(row => row.kind === 'dependency-change' && row.reason === 'code dependencies')).toBe(true);
            expect(rows.some(row => row.kind === 'deopt-eager' && row.reason === 'wrong map')).toBe(true);
            expect(report.deoptimizations.intervalUnmatched).toBe(0);
        } else expect(() => summarize(log)).toThrow('Unsupported V8 code-log version');
        expect(fs.readdirSync(workspace.directory)).toEqual([]);
    }), 20000);
