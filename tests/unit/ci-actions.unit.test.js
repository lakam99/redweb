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
