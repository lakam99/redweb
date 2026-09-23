'use strict';

const fs = require('node:fs');
const path = require('node:path');
const workflow = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/ci.yml'), 'utf8').replace(/\r\n/g, '\n');
const scripts = require('../../package.json').scripts;
const step = name => {
    const start = workflow.indexOf(`      - name: ${name}\n`);
    expect(start).toBeGreaterThan(-1);
    const end = workflow.indexOf('\n      - ', start + 1);
    return workflow.slice(start, end === -1 ? undefined : end);
};

// Configuration regression checks; actual GitHub jobs exercise the shell,
// status propagation, artifact upload and real recovery commands independently.
test('server acceptance stays blocking, bounded and uses the reviewed command', () => {
    const gate = step('Server recovery acceptance (server-steady-v1)');
    expect(gate).toContain('npm run verify:recovery:server -- "$GITHUB_WORKSPACE/coverage/server-recovery"');
    expect(gate).toContain('timeout-minutes: 2');
    expect(gate).not.toContain('continue-on-error');
    expect(scripts['verify:recovery:server']).toBe('node scripts/verify-server-recovery.js');
    expect(workflow).toContain('run: npm run verify:recovery:coverage');
    for (const file of ['scripts/lib/ServerRecoveryPolicy.js', 'scripts/lib/ServerRecoveryCandidate.js',
        'scripts/verify-server-recovery.js', 'scripts/diagnostics/recovery-split.cjs',
        'scripts/diagnostics/recovery-split-worker.cjs']) {
        expect(scripts['verify:recovery:coverage']).toContain(`--collectCoverageFrom=${file}`);
    }
    expect(scripts['verify:recovery:coverage']).not.toContain('--coverageThreshold');
});

test('authored recovery coverage includes native and boundary tests and retains failures', () => {
    const command = scripts['verify:recovery:coverage'];
    for (const file of ['recovery-split.unit', 'recovery-coordinator-boundaries.unit',
        'recovery-worker-boundaries.unit', 'recovery-worker-error.unit',
        'recovery-split.integration', 'recovery-channel.integration']) {
        expect(command).toContain(`${file}.test.js`);
    }
    expect(workflow).toContain('run: npm run verify:recovery:coverage\n        id: server-recovery-coverage\n        timeout-minutes: 3');
    const artifact = step('Preserve server recovery authored coverage');
    expect(artifact).toContain("always() && steps.server-recovery-coverage.outcome != 'skipped'");
    expect(artifact).toContain('path: coverage/server-recovery-acceptance/');
    expect(artifact).toContain('if-no-files-found: error');
    expect(artifact).toContain('retention-days: 30');
});

test('original command is unchanged, visibly non-blocking and never follows uncertain server cleanup', () => {
    const original = step('Original shared-process recovery (non-blocking diagnostic)');
    expect(scripts['verify:recovery']).toBe('node --expose-gc scripts/verify-recovery.js');
    expect(original).toContain("!cancelled() && steps.recovery.outcome == 'success'");
    expect(original).toContain('continue-on-error: true');
    expect(original).toContain('timeout-minutes: 2');
    expect(original).toContain('shell: bash');
    expect(original).toContain('run: npm run verify:recovery 2>&1 | tee coverage/recovery-original.log');
    expect(original).not.toContain('|| true');
});

test('original verifier coverage is a separate bounded gate with retained artifacts', () => {
    const command = scripts['verify:recovery:original:coverage'];
    expect(command).toContain('tests/unit/original-recovery.unit.test.js');
    expect(command).toContain('tests/integration/recovery-verifier.integration.test.js');
    expect(command).toContain('--collectCoverageFrom=scripts/verify-recovery.js');
    expect(command).not.toContain('--coverageThreshold');
    expect(workflow).toContain('run: npm run verify:recovery:original:coverage\n        id: original-recovery-coverage\n        timeout-minutes: 5');
    const artifact = step('Preserve original recovery verifier coverage');
    expect(artifact).toContain("always() && steps.original-recovery-coverage.outcome != 'skipped'");
    expect(artifact).toContain('path: coverage/original-recovery/');
    expect(artifact).toContain('if-no-files-found: error');
    expect(artifact).toContain('retention-days: 30');
});

test('raw outcomes and evidence remain visible on failure, not just successful runs', () => {
    const summary = step('Recovery outcome summary');
    const artifact = step('Preserve recovery evidence on success or failure');
    for (const value of [summary, artifact]) expect(value).toContain('always()');
    expect(summary).toContain('steps.recovery-original.outcome');
    expect(summary).not.toContain('steps.recovery-original.conclusion');
    expect(summary).toContain('::warning::');
    expect(summary).toContain('$GITHUB_STEP_SUMMARY');
    expect(artifact).toContain('coverage/server-recovery/');
    expect(artifact).toContain('coverage/recovery-original.log');
    expect(artifact).toContain('if-no-files-found: error');
    expect(artifact).toContain('retention-days: 30');
});
