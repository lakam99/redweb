'use strict';

const fs = require('node:fs');
const path = require('node:path');
const workflow = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/ci.yml'), 'utf8');

// These are configuration regressions, not simulations of a GitHub runner.
// Actual CI verifies checkout, npm caching and retained artifact uploads.
test('CI action dependencies use the reviewed immutable Node 24 releases', () => {
    const revisions = {
        checkout: '3d3c42e5aac5ba805825da76410c181273ba90b1',
        'setup-node': '820762786026740c76f36085b0efc47a31fe5020',
        'upload-artifact': '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    };
    const uses = [...workflow.matchAll(/uses:\s+actions\/([\w-]+)@([^\s]+)/g)];
    expect(new Set(uses.map(([, action]) => action))).toEqual(new Set(Object.keys(revisions)));
    for (const [, action, revision] of uses) expect(revision).toBe(revisions[action]);
});

test('the action runtime upgrade preserves Redweb compatibility and read-only CI', () => {
    expect(workflow).toContain('node: [18, 20, 22, 24]');
    expect(workflow).toContain('node-version: ${{ matrix.node }}');
    expect(workflow).toContain('node-version: 22');
    expect(workflow).toMatch(/permissions:\s*\r?\n\s+contents: read/);
    expect(workflow).not.toContain('pull_request_target:');
    expect(workflow).not.toContain('ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION');
});

test('matrix failures retain any available raw soak observations', () => {
    const matrix = workflow.slice(workflow.indexOf('  test:'), workflow.indexOf('  lifecycle-smoke:'));
    expect(matrix).toMatch(/run: npm test -- --runInBand --silent\s+id: matrix-tests/);
    expect(matrix).toContain("always() && steps.matrix-tests.outcome != 'skipped'");
    expect(matrix).toContain('name: matrix-soak-${{ matrix.node }}-${{ github.event_name }}-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(matrix).toContain('path: coverage/soak-tools/smoke-reports/');
    // A pretest/launch failure can legitimately precede the measurement file.
    expect(matrix).toContain('if-no-files-found: warn');
    expect(matrix).toContain('retention-days: 30');
    const command = require('../../package.json').scripts['verify:soak:coverage'];
    expect(command).toContain('tests/unit/soak-command-evidence.unit.test.js');
    expect(command).toContain('--collectCoverageFrom=tests/helpers/SoakCommandEvidence.js');
    expect(command).not.toContain('--coverageThreshold');
});

test('package CI runs the authored coverage gate once and retains both evidence scopes', () => {
    const scripts = require('../../package.json').scripts;
    expect(workflow.match(/run: npm run verify:package:coordinator:coverage/g)).toHaveLength(1);
    expect(workflow).not.toMatch(/run: npm run verify:live-html:package\s/);
    expect(workflow).toMatch(/run: npm run verify:package:coordinator:coverage\s+id: packed-browser\s+timeout-minutes: 20/);
    expect(workflow).toMatch(/path: \|\s+coverage\/packed-browser\/\s+coverage\/package-coordinator\//);
    for (const file of ['tests/unit/package-coordinator.unit.test.js',
        'tests/unit/packed-browser-report.unit.test.js',
        'tests/unit/packed-browser-report-failures.unit.test.js',
        'tests/integration/package-coordinator.integration.test.js']) {
        expect(scripts['verify:package:coordinator:coverage']).toContain(file);
        expect(fs.existsSync(path.resolve(__dirname, '../..', file))).toBe(true);
    }
    expect(scripts['verify:package:coordinator:coverage']).toContain('--collectCoverageFrom=scripts/verify-live-html-package.js');
    expect(scripts['verify:package:coordinator:coverage']).toContain('--collectCoverageFrom=scripts/lib/preservePackedBrowserReport.js');
    expect(scripts['verify:package:coordinator:coverage']).toContain('--coverageDirectory=coverage/package-coordinator');
});

test('browser CI combines coordinator and helper scopes without duplicating native workloads', () => {
    const scripts = require('../../package.json').scripts;
    expect(scripts['verify:browser:coverage']).toContain('&& npm run verify:browser:coordinator:coverage');
    expect(scripts['verify:browser:coverage']).not.toMatch(/npm run verify:(browser:supplements|refresh:coverage)/);
    for (const file of ['scripts/verify-browser-coverage.js', 'scripts/lib/verify-live-page-ownership.js',
        'scripts/lib/verify-runtime-browser.js', 'scripts/lib/verify-refresh-controls.js', 'scripts/lib/verify-refresh-coverage.js']) {
        expect(scripts['verify:browser:coordinator:coverage']).toContain('--collectCoverageFrom=' + file);
    }
    expect(workflow).toContain('coverage/browser-coordinator/');
    expect(workflow).toContain('coverage/browser-client/');
    expect(workflow).not.toContain('REDWEB_VERIFY_CLIENT_SOURCE');
});

test('frozen-tool coverage remains separate from behavioral evaluation controls', () => {
    const scripts = require('../../package.json').scripts;
    expect(scripts['verify:agents:controls']).toBe('node scripts/evaluation/validate.js');
    expect(scripts['verify:evaluation:process:coverage']).toContain('--collectCoverageFrom=scripts/evaluation/process.js');
    expect(scripts['verify:evaluation:process:coverage']).toContain('--collectCoverageFrom=scripts/evaluation/seal.js');
    expect(scripts['verify:evaluation:process:coverage']).toContain('tests/integration/evaluation-frozen.integration.test.js');
    expect(workflow).toMatch(/run: npm run verify:evaluation:process:coverage\s+id: frozen-process-seal\s+timeout-minutes: 5/);
    expect(workflow).toContain('coverage/frozen-process-seal/');
    expect(scripts['verify:evaluation:prepare:coverage']).toContain('--collectCoverageFrom=scripts/evaluation/prepare.js');
    expect(scripts['verify:evaluation:prepare:coverage']).toContain('tests/integration/evaluation-prepare.integration.test.js');
    expect(scripts['verify:evaluation:prepare:coverage']).toContain('tests/unit/evaluation-prepare-boundaries.unit.test.js');
    expect(workflow).toMatch(/run: npm run verify:evaluation:prepare:coverage\s+id: frozen-prepare\s+timeout-minutes: 5/);
    expect(workflow).toContain('coverage/frozen-prepare/');
    expect(scripts['verify:evaluation:trial:coverage']).toContain('--collectCoverageFrom=scripts/evaluation/run-trial.js');
    expect(scripts['verify:evaluation:trial:coverage']).toContain('tests/integration/evaluation-trial.integration.test.js');
    expect(scripts['verify:evaluation:trial:coverage']).toContain('tests/unit/evaluation-trial-boundaries.unit.test.js');
    expect(workflow).toMatch(/run: npm run verify:evaluation:trial:coverage\s+id: frozen-trial\s+timeout-minutes: 5/);
    expect(workflow).toContain('coverage/frozen-trial/');
    expect(scripts['verify:evaluation:controls:coverage']).toContain('--collectCoverageFrom=scripts/evaluation/validate.js');
    expect(scripts['verify:evaluation:controls:coverage']).toContain('--collectCoverageFrom=scripts/evaluation/verify.js');
    expect(scripts['verify:evaluation:controls:coverage']).toContain('tests/integration/evaluation-controls.integration.test.js');
    expect(scripts['verify:evaluation:controls:coverage']).toContain('tests/unit/evaluation-controls-boundaries.unit.test.js');
    expect(scripts['verify:evaluation:controls:coverage']).toContain('tests/integration/evaluation-verifier.integration.test.js');
    expect(scripts['verify:evaluation:controls:coverage']).toContain('tests/unit/evaluation-verifier-boundaries.unit.test.js');
    expect(workflow).toMatch(/run: npm run verify:evaluation:controls:coverage\s+id: frozen-controls\s+timeout-minutes: 5/);
    expect(workflow).toContain('coverage/frozen-controls/');
    expect(workflow).toContain('coverage/frozen-evaluator-native/');
});

test('Live HTML CI measures the existing native workload once alongside explicit boundary units', () => {
    const scripts = require('../../package.json').scripts;
    expect(workflow.match(/run: npm run verify:live-html:browser:coverage/g)).toHaveLength(1);
    expect(workflow).not.toMatch(/run: npm run verify:live-html:browser\s/);
    expect(workflow).toMatch(/run: npm run verify:live-html:browser:coverage\s+id: frozen-live-browser\s+timeout-minutes: 5/);
    expect(workflow).toContain('coverage/frozen-live-browser/');
    expect(scripts['verify:live-html:browser:coverage']).toContain('--collectCoverageFrom=scripts/verify-live-html-browser.js');
    for (const file of ['tests/integration/frozen-live-browser.integration.test.js', 'tests/unit/frozen-live-browser.unit.test.js']) {
        expect(scripts['verify:live-html:browser:coverage']).toContain(file);
        expect(fs.existsSync(path.resolve(__dirname, '../..', file))).toBe(true);
    }
});
