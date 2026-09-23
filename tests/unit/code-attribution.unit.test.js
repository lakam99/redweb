'use strict';

const test = globalThis.test ?? require('node:test').test;
const expect = globalThis.expect ?? require('expect').expect;
const path = require('node:path');
const { CodeAttribution } = require('../../scripts/diagnostics/CodeAttribution.cjs');
const { HeapCodeComparison, analyzeReport } = require('../../scripts/diagnostics/HeapCodeComparison.cjs');

const edge = (target, name, kind = 'internal') => ({ target, name, kind });
const node = (id, type, name, out = []) => ({ id, type, name, out, size: 16 });
function records() {
    return [node(1, 'synthetic', '', [edge(30, 'root')]),
        node(10, 'code', 'PRIVATE-SCRIPT', [edge(11, 'name')]), node(11, 'string', 'node:net'),
        node(12, 'string', 'PRIVATE-SCOPE'), node(13, 'code', 'system / BytecodeArray'),
        ...[20, 21].map(id => node(id, 'code', 'initAsClient', [edge(10, 'script'), edge(12, 'name_or_scope_info'), edge(90, 'function_data')])),
        node(30, 'closure', 'PRIVATE-CLOSURE', [edge(20, 'shared'), edge(40, 'code'), edge(70, 'feedback_cell')]),
        node(40, 'code', '(code)', [edge(50, 'deoptimization_data'), edge(60, 'instruction_stream'), edge(80, 'source_position_table')]),
        node(50, 'code', '(code deopt data)', [edge(20, 2, 'hidden'), edge(51, 3, 'hidden')]),
        node(51, 'code', '(code deopt data)', [edge(21, 0, 'hidden')]),
        node(60, 'code', 'PRIVATE-INSTRUCTIONS', [edge(40, 'code'), edge(81, 'relocation_info')]),
        node(70, 'code', 'system / FeedbackCell', [edge(71, 'value')]),
        node(71, 'code', 'system / FeedbackVector', [edge(20, 0, 'hidden'), edge(40, 'optimized code', 'weak')]),
        node(80, 'code', '(source position table)'), node(81, 'code', '(code relocation info)'),
        node(90, 'code', 'PRIVATE-BASELINE', [edge(13, 'interpreter_data')])];
}
function graph(input) {
    const types = ['synthetic', 'code', 'string', 'closure', 'object'];
    const kinds = ['internal', 'hidden', 'weak', 'shortcut', 'property', 'context'];
    const strings = [], nodes = [], edges = [];
    const intern = value => { strings.push(value); return strings.length - 1; };
    for (const item of input) {
        nodes.push(types.indexOf(item.type), intern(item.name), item.id, item.size, item.out.length);
        for (const link of item.out) edges.push(kinds.indexOf(link.kind), link.kind === 'hidden' ? link.name : intern(link.name), input.findIndex(n => n.id === link.target) * 5);
    }
    return new HeapCodeComparison({ snapshot: { meta: { node_fields: ['type', 'name', 'id', 'self_size', 'edge_count'], node_types: [types],
        edge_fields: ['type', 'name_or_index', 'to_node'], edge_types: [kinds] } }, nodes, edges, strings });
}
const at = (input, id) => input.find(n => n.id === id);
const analyze = input => new CodeAttribution(graph(input));
const empty = () => analyze([node(1, 'synthetic', '')]);
function addCode(input, { id = 41, shared = 20, closure = true } = {}) {
    input.push(node(id, 'code', '(code)', [edge(52, 'deoptimization_data'), edge(61, 'instruction_stream')]),
        node(52, 'code', '(code deopt data)', [edge(shared, 8, 'hidden'), edge(51, 9, 'hidden')]),
        node(61, 'code', 'PRIVATE-SECOND', [edge(id, 'code')]));
    if (closure) input.push(node(31, 'closure', 'PRIVATE-SECOND-CLOSURE', [edge(shared, 'shared'), edge(id, 'code')]));
}

function addFunction(input, id, name, source, out = []) {
    input.push(node(id, 'closure', name, [edge(id + 1, 'shared'), ...out]),
        node(id + 1, 'code', name, [edge(id + 2, 'script'), edge(12, 'name_or_scope_info'), edge(13, 'function_data')]),
        node(id + 2, 'code', 'PRIVATE-SCRIPT', [edge(id + 3, 'name')]), node(id + 3, 'string', source));
}

function workerRecords() {
    const input = records(), root = path.resolve(__dirname, '../..');
    addFunction(input, 100, 'PRIVATE-LISTENER', path.join(root, 'scripts/diagnostics/recovery-split-worker.cjs'), [edge(202, 'context')]);
    addFunction(input, 110, 'WebSocket', path.join(root, 'node_modules/ws/lib/websocket.js'), [edge(203, 'context')]);
    addFunction(input, 120, 'initAsClient', path.join(root, 'node_modules/ws/lib/websocket.js'));
    addFunction(input, 130, 'closeClient', path.join(root, 'scripts/realtime-harness.js'));
    addFunction(input, 140, 'waitFor', path.join(root, 'scripts/realtime-harness.js'));
    input.push(node(200, 'object', 'process', [edge(201, '_events', 'property')]),
        node(201, 'object', 'Object', [edge(100, 'message', 'property')]),
        node(202, 'object', 'system / Context', [edge(110, 'WebSocket', 'context'), edge(130, 'closeClient', 'context'), edge(140, 'waitFor', 'context')]),
        node(203, 'object', 'system / Context', [edge(204, 'previous')]),
        node(204, 'object', 'system / Context', [edge(120, 'initAsClient', 'context')]),
        node(210, 'object', 'Module', [edge(110, 'exports', 'property'), edge(211, 'filename', 'property')]),
        node(211, 'string', path.join(root, 'node_modules/ws/lib/websocket.js')),
        node(220, 'object', 'Module', [edge(110, 'exports', 'property'), edge(221, 'filename', 'property')]),
        node(221, 'string', 'node_modules/ws/index.js'));
    at(input, 1).out.push(edge(200, 'process'), edge(210, 'module1'), edge(220, 'module2'));
    return input;
}

test('current-slot code is associated structurally while nested inlined functions and weak caches are not owners', () => {
    const current = analyze(records()), result = current.compare(empty());
    expect(result.after).toMatchObject({ statuses: { associated: 1, ambiguousSfi: 0 }, associatedFunctions: 1, currentCodes: 1, histogram: { 1: 1 } });
    expect(result.functions[0].after).toMatchObject({ name: 'initAsClient', codes: 1, currentCodes: 1, feedbackVectors: 1 });
    expect(result.roles.find(row => row.role === 'deoptData').afterCount).toBe(2);
    expect(result.distinctCodeAndImmediateMetadata.after).toEqual({ count: 6, selfBytes: 96 });
    expect(result.invalidationStatusKnown).toBe(false);
    expect(result.exclusiveOwnershipProven).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE-|codeIds|baselineIds/);
});

test('existing SFI and closure gain a code slot while retaining the same baseline object', () => {
    const prior = records().filter(n => ![40, 50, 51, 60, 80, 81].includes(n.id));
    at(prior, 30).out.find(e => e.name === 'code').target = 90;
    at(prior, 71).out = [edge(20, 0, 'hidden')];
    const result = analyze(records()).compare(analyze(prior));
    expect(result.preexistingFunctionCodes).toBe(1);
    expect(result.preexistingClosureCodes).toBe(1);
    expect(result.functions[0]).toMatchObject({ sameFunctionIdentity: true, sameBaselineCode: true,
        before: { codes: 0, baselineCodes: 1 }, after: { codes: 1, baselineCodes: 1 } });
});

test('identity grouping distinguishes same-named functions and deduplicates shared metadata globally', () => {
    const input = records(); addCode(input, { shared: 21 });
    const result = analyze(input).compare(empty());
    expect(result.after.histogram).toEqual({ 1: 2 });
    expect(result.functionGroups).toBe(2);
    expect(result.roles.find(row => row.role === 'deoptData').afterCount).toBe(3);
    expect(result.functions.reduce((sum, row) => sum + row.after.deoptDataSelfBytes, 0)).toBe(64);
    expect(result.roles.find(row => row.role === 'deoptData').afterSelfBytes).toBe(48);
    expect(result.perFunctionBytesMayOverlap).toBe(true);
});

test('multiple code slots are separated from current references and checked for unchanged IDs', () => {
    const prior = records(); addCode(prior);
    const inventory = analyze(prior);
    expect(inventory.compare(inventory).multipleVersionGroupsAfter).toEqual({ groups: 1, unchangedCodeSets: 1, allCurrentInClosures: 1 });
    const current = records(); addCode(current, { id: 42, closure: false });
    expect(analyze(current).compare(inventory).multipleVersionGroupsAfter).toEqual({ groups: 1, unchangedCodeSets: 0, allCurrentInClosures: 0 });
    expect(analyze(prior).compare(empty()).multipleVersionGroupsAfter.unchangedCodeSets).toBe(0);
    expect(analyze(prior).compare(analyze(records())).multipleVersionGroupsAfter.unchangedCodeSets).toBe(0);
});

test('missing, ambiguous, weak-only, conflicting and unsupported relationships are explicit', () => {
    for (const kind of ['weak', 'shortcut', 'property']) {
        const input = records(); at(input, 50).out[0] = edge(20, 'not-strong-field', kind);
        expect(analyze(input).statuses.missingSfi).toBe(1);
    }
    const ambiguous = records(); at(ambiguous, 50).out.push(edge(21, 7, 'hidden'));
    expect(analyze(ambiguous).statuses.ambiguousSfi).toBe(1);
    const conflict = records(); at(conflict, 30).out[0].target = 21;
    expect(analyze(conflict).statuses.conflictingClosure).toBe(1);
    const mutations = [
        r => { at(r, 40).out.push(edge(50, 'deoptimization_data')); },
        r => { at(r, 40).out = at(r, 40).out.filter(e => e.name !== 'instruction_stream'); },
        r => { at(r, 50).type = 'object'; }, r => { at(r, 60).type = 'object'; },
        r => { at(r, 60).out[0].target = 90; },
    ];
    for (const mutate of mutations) { const input = records(); mutate(input); expect(analyze(input).statuses.unsupportedStructure).toBe(1); }
    const result = analyze(ambiguous).compare(empty());
    expect(result.addedCodeAndStreamBySource).toEqual([{ sourceGroup: 'unresolved', count: 1, selfBytes: 32 }]);
});

test('SFI structure is required and field duplicates cannot be guessed', () => {
    const mutations = [r => { at(r, 20).out.pop(); }, r => { at(r, 20).out.shift(); },
        r => { at(r, 20).out.splice(1, 1); }, r => { at(r, 10).type = 'object'; },
        r => { at(r, 20).out.push(edge(10, 'script'), edge(10, 'script')); }];
    for (const mutate of mutations) { const input = records(); mutate(input); expect(analyze(input).statuses.missingSfi).toBe(1); }
    const input = records(); at(input, 30).out = at(input, 30).out.filter(e => e.name !== 'code');
    expect(analyze(input).inventory().currentCodes).toBe(0);
});

test('feedback association rejects missing/multiple SFIs and conflicting closure owners', () => {
    for (const out of [[], [edge(20, 0, 'hidden'), edge(21, 1, 'hidden')]]) {
        const input = records(); at(input, 71).out = out;
        const result = analyze(input).compare(empty());
        expect(result.after.feedbackStatuses.unresolved).toBe(1);
        expect(result.addedFeedbackBySource[0].sourceGroup).toBe('unresolved');
    }
    const wrong = records(); at(wrong, 71).out = [edge(21, 0, 'hidden')];
    expect(analyze(wrong).feedbackStatuses.conflictingClosure).toBe(1);
    for (const remove of [30, 70]) {
        const input = records(); at(input, remove).out = at(input, remove).out.filter(e => !['feedback_cell', 'value'].includes(e.name));
        expect(analyze(input).feedbackStatuses.associated).toBe(1);
    }
    const uninitialized = records(); at(uninitialized, 71).name = 'PRIVATE-NO-FEEDBACK';
    expect(analyze(uninitialized).roles.feedbackVector.size).toBe(0);
});

test('source/function output is independently allowlisted and has only fixed broad groups', () => {
    const root = path.resolve(__dirname, '../..');
    for (const [source, group] of [['node:internal/private-module', 'node-builtin'],
        [path.join(root, 'node_modules/ws/lib/websocket.js'), 'ws'],
        [path.join(root, 'scripts/realtime-harness.js'), 'realtime-harness'],
        [path.join(root, 'scripts/diagnostics/ClientHeapCapture.cjs'), 'capture-observer'],
        ['PRIVATE-FILENAME', 'other']]) {
        const input = records(); at(input, 11).name = source; at(input, 20).name = 'PRIVATE-FUNCTION';
        const label = analyze(input).inventory().functions.get(20);
        expect(label.sourceGroup).toBe(group); expect(label.name).toBe('unclassified');
        expect(JSON.stringify(analyze(input).compare(empty()))).not.toMatch(/PRIVATE-|private-module/);
    }
    for (const mutate of [r => { at(r, 10).out = []; }, r => { at(r, 11).type = 'object'; }]) {
        const input = records(); mutate(input); expect(analyze(input).inventory().functions.get(20).source).toBe('unclassified');
    }
});

test('removed/new closures and identities, omitted rows and processing budgets remain visible', () => {
    const input = records(); at(input, 30).id = 32; at(input, 1).out[0].target = 32;
    expect(analyze(input).compare(analyze(records())).preexistingClosureCodes).toBe(0);
    expect(empty().compare(analyze(records())).functions[0].after).toBeNull();
    const multiple = records(); addCode(multiple, { shared: 21 });
    expect(empty().compare(analyze(multiple)).functions).toHaveLength(2);
    expect(analyze(multiple).compare(empty(), 1)).toMatchObject({ functionGroups: 2, omittedFunctionGroups: 1 });
    expect(() => analyze(input).compare(empty(), 0)).toThrow();
    expect(() => new CodeAttribution(graph(input), path.resolve(__dirname), 0)).toThrow();
    expect(() => new CodeAttribution(graph(input), path.resolve(__dirname), 1)).toThrow('association limit exceeded');
    expect(() => analyzeReport('unused', 'unused', 'unsupported')).toThrow();
});

test('an unsupported Code cannot charge a different Code object\'s validated instruction stream', () => {
    const input = records(); addCode(input, { shared: 21 });
    at(input, 40).out.find(e => e.name === 'instruction_stream').target = 61;
    const report = analyze(input).compare(empty());
    expect(report.after.statuses.unsupportedStructure).toBe(1);
    expect(report.addedCodeAndStreamBySource).toEqual([
        { sourceGroup: 'node-builtin', count: 1, selfBytes: 32 },
        { sourceGroup: 'unresolved', count: 1, selfBytes: 16 }]);
});

test('Socket roles require matching source and structural references, never sizes', () => {
    const input = records();
    addFunction(input, 100, 'getStderr', 'node:internal/bootstrap/switches/is_main_thread', [edge(200, 'context')]);
    addFunction(input, 110, 'TLSSocket', 'node:_tls_wrap', [edge(202, 'prototype', 'property')]);
    addFunction(input, 120, 'JSStreamSocket', 'node:internal/js_stream_socket', [edge(203, 'prototype', 'property')]);
    input.push(node(200, 'object', 'system / Context', [edge(201, 'stderr', 'context')]),
        ...[201, 202, 203, 204].map(id => node(id, 'object', 'Socket')));
    const inventory = analyze(input);
    expect([...inventory.socketInventory().values()].map(row => row.kind)).toEqual(['stderr-cache', 'tls-prototype', 'js-stream-prototype', 'unclassified']);
    expect(inventory.compare(inventory).socketRoles.find(row => row.kind === 'stderr-cache')).toMatchObject({ sameIdentityAndRoleCount: 1 });
    expect(inventory.compare(empty()).socketRoles.find(row => row.kind === 'stderr-cache')).toMatchObject({ sameIdentityAndRoleCount: 0 });
    at(input, 110).out.push(edge(201, 'prototype', 'property'));
    expect(analyze(input).socketInventory().get(201).kind).toBe('ambiguous');
    at(input, 110).out.pop();
    for (const change of [r => { at(r, 100).out.pop(); }, r => { at(r, 200).type = 'code'; },
        r => { at(r, 200).name = 'PRIVATE-CONTEXT'; }, r => { at(r, 103).name = 'PRIVATE-SOURCE'; },
        r => { at(r, 200).out[0] = edge(201, 'stderr', 'weak'); }]) {
        const copy = structuredClone(input); change(copy);
        expect(analyze(copy).socketInventory().get(201).kind).toBe('unclassified');
    }
});

test('persistent worker/module paths use exact edge kinds, source labels, identity and root reachability', () => {
    const input = workerRecords(), inventory = analyze(input);
    expect(inventory.compare(inventory).persistentWorkerPath).toEqual({
        before: { matchedPaths: 1, uniquePath: true, helperBindings: ['closeClient', 'waitFor'], rootedModuleExports: 2 },
        after: { matchedPaths: 1, uniquePath: true, helperBindings: ['closeClient', 'waitFor'], rootedModuleExports: 2 }, sameEightNodes: true });
    const changed = workerRecords(); at(changed, 200).id = 205; at(changed, 1).out.find(e => e.target === 200).target = 205;
    expect(analyze(changed).compare(inventory).persistentWorkerPath.sameEightNodes).toBe(false);
    const duplicate = workerRecords(); duplicate.push(node(230, 'object', 'process', [edge(201, '_events', 'property')])); at(duplicate, 1).out.push(edge(230, 'duplicate'));
    expect(analyze(duplicate).workerPath().summary).toMatchObject({ matchedPaths: 2, uniquePath: false, helperBindings: [], rootedModuleExports: 2 });
    expect(analyze(duplicate).compare(inventory).persistentWorkerPath.sameEightNodes).toBe(false);
    expect(inventory.compare(analyze(duplicate)).persistentWorkerPath.sameEightNodes).toBe(false);
    const mutations = [r => { at(r, 201).out = []; }, r => { at(r, 100).type = 'object'; },
        r => { at(r, 100).out = at(r, 100).out.filter(e => e.name !== 'shared'); },
        r => { at(r, 103).name = 'PRIVATE-SOURCE'; }, r => { at(r, 111).name = 'PRIVATE-WEBSOCKET'; },
        r => { at(r, 123).name = 'PRIVATE-INIT-SOURCE'; }, r => { at(r, 201).type = 'code'; },
        r => { at(r, 202).name = 'PRIVATE-CONTEXT'; }, r => { at(r, 203).type = 'code'; },
        r => { at(r, 1).out = at(r, 1).out.filter(e => e.target !== 200); },
        r => { at(r, 202).out[0].kind = 'weak'; }];
    for (const mutate of mutations) { const copy = workerRecords(); mutate(copy); expect(analyze(copy).workerPath().summary.matchedPaths).toBe(0); }
    const noHelper = workerRecords(); at(noHelper, 202).out = at(noHelper, 202).out.filter(e => e.name !== 'waitFor');
    expect(analyze(noHelper).workerPath().summary.helperBindings).toEqual(['closeClient']);
    for (const mutate of [r => { at(r, 210).out.pop(); }, r => { at(r, 211).type = 'object'; },
        r => { at(r, 211).name = 'PRIVATE-FILENAME'; }, r => { at(r, 210).out[0].target = 120; },
        r => { at(r, 1).out = at(r, 1).out.filter(e => e.target !== 210); }]) {
        const copy = workerRecords(); mutate(copy); expect(analyze(copy).workerPath().summary.rootedModuleExports).toBe(1);
    }
    expect(JSON.stringify(inventory.compare(inventory))).not.toMatch(/PRIVATE-|paths|baselineIds|codeIds/);
});
