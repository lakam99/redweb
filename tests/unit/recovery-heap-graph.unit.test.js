'use strict';

const { HeapGraph, marker, captureMarker } = require('../../scripts/diagnostics/recovery-heap-graph.cjs');

const runId = '123:12345678-1234-1234-1234-123456789abc';
const phases = ['warm', 'storm-3', 'recovered'];
const edge = (target, name = 'value', kind = 'property') => ({ target, name, kind });
const object = (id, edges = [], name = 'Object', type = 'object') => ({ id, type, name, size: 16, edges });

function snapshot(phase, extra = [], rootEdges = [], identity = runId) {
    const records = [object(1, [edge(2, marker), edge(3 + phases.indexOf(phase), captureMarker), ...rootEdges]),
        { id: 2, type: 'string', name: identity, size: 64, edges: [] },
        ...phases.map((name, i) => ({ id: 3 + i, type: 'string', name, size: 16, edges: [] })), ...extra];
    const nodeTypes = ['object', 'string', 'array', 'hidden', 'closure', 'code'];
    const edgeTypes = ['property', 'element', 'internal', 'weak', 'hidden', 'context', 'shortcut'];
    const strings = [];
    const intern = value => { if (!strings.includes(value)) strings.push(value); return strings.indexOf(value); };
    const nodes = [], edges = [];
    for (const node of records) {
        nodes.push(nodeTypes.indexOf(node.type), intern(node.name), node.id, node.size, node.edges.length);
        for (const link of node.edges) edges.push(edgeTypes.indexOf(link.kind),
            ['element', 'hidden'].includes(link.kind) ? 0 : intern(link.name), records.findIndex(value => value.id === link.target) * 5);
    }
    return { snapshot: { meta: { node_fields: ['type', 'name', 'id', 'self_size', 'edge_count'], node_types: [nodeTypes],
        edge_fields: ['type', 'name_or_index', 'to_node'], edge_types: [edgeTypes] } }, nodes, edges, strings };
}

test('diagnostic data excludes prototypes/code, preserves shared data and gross deltas, and finds only candidate retainers', () => {
    const extra = [object(10, [edge(11), edge(12, '__proto__'), edge(13, 'map', 'internal')]),
        object(11), object(12), object(13, [], 'private-code-name', 'code'),
        object(20, [edge(11, 'shared')], 'SocketServer')];
    const roots = [edge(10)];
    const before = new HeapGraph(snapshot('warm', extra, roots));
    const currentExtra = [...extra.map(node => ({ ...node, edges: [...node.edges] })),
        object(30, [edge(31)], 'private-account-name'), object(31, [edge(30)]), object(32)];
    currentExtra.find(node => node.id === 20).edges.push(edge(30, 'private-session-token'), edge(32, 'weak-secret', 'weak'));
    const after = new HeapGraph(snapshot('storm-3', currentExtra, roots));
    expect([...after.data].map(index => after.nodes[index].id).sort((a, b) => a - b)).toEqual([1, 10, 11]);
    const report = after.report(before);
    expect(report.exclusiveOwnershipProven).toBe(false);
    expect(report.markedRecords).toBe(1);
    expect(report.grossDeltas.find(value => value.group === 'object:Object').delta.count).toBe(2);
    expect(report.buckets.find(value => value.category === 'outside-diagnostic-data' && value.group === 'type:object').addedRetainerHints)
        .toEqual({ 'object:SocketServer:property': 1 });
    expect(report.traversal.unresolvedCandidates).toBe(1); // Weak reference is not a retainer.
    expect(JSON.stringify(report)).not.toMatch(/private-|12345678|__redweb/);
    expect(after.report(before)).toEqual(report); // Traversal budgets reset per report.
});

test('own array elements and backing stores are data, unsupported class instances are not', () => {
    const extra = [object(10, [edge(11, '0', 'element'), edge(12, 'elements', 'internal'), edge(13)], 'Array'),
        object(11), object(12, [], 'private-storage', 'array'), object(13, [], 'private-class')];
    const before = new HeapGraph(snapshot('warm'));
    const after = new HeapGraph(snapshot('storm-3', extra, [edge(10)]));
    expect([...after.data].map(index => after.nodes[index].id).sort((a, b) => a - b)).toEqual([1, 10, 11, 12]);
    const report = after.report(before);
    expect(report.buckets.find(value => value.group === 'type:object').addedRetainerHints).toEqual({ 'diagnostic-data:property': 1 });
    expect(report.removedNodeCount).toBe(0);
    const final = new HeapGraph(snapshot('recovered'));
    const removed = final.report(after);
    expect(removed.removedNodeCount).toBe(4);
    expect(removed.buckets.find(bucket => bucket.group === 'object:Array')).toMatchObject({ beforeCount: 1, count: 0, netCount: -1,
        removedCount: 1, removedSelfBytes: 16, netSelfBytes: -16 });
});

test('a shared node changing diagnostic reachability moves partitions without being added or removed', () => {
    const extra = [object(10), object(20, [edge(10, 'shared')], 'SocketServer')];
    const before = new HeapGraph(snapshot('warm', extra));
    const after = new HeapGraph(snapshot('storm-3', extra, [edge(10)]));
    const report = after.report(before);
    expect(report.grossDeltas.find(value => value.group === 'object:Object').delta.count).toBe(0);
    expect(report.buckets.find(bucket => bucket.group === 'object:Object' && bucket.category === 'diagnostic-data-reachable'))
        .toMatchObject({ beforeCount: 1, count: 2, netCount: 1, addedCount: 0, removedCount: 0, movedInCount: 1 });
    expect(report.buckets.find(bucket => bucket.group === 'object:Object' && bucket.category === 'outside-diagnostic-data'))
        .toMatchObject({ beforeCount: 1, count: 0, netCount: -1, addedCount: 0, removedCount: 0, movedOutCount: 1 });
    expect(report.exclusiveOwnershipProven).toBe(false);
});

test('cycles terminate; graph, candidate, depth and global traversal budgets are explicit', () => {
    const extra = [object(10, [edge(11)]), object(11, [edge(10)]), object(12, [edge(10)])];
    const before = new HeapGraph(snapshot('warm'));
    for (const limits of [{ candidates: 1 }, { visits: 1 }, { edgeVisits: 1 }, { perCandidateNodes: 1 }, { perCandidateEdges: 1 }, { depth: 1 }]) {
        const result = new HeapGraph(snapshot('storm-3', extra), limits).report(before);
        expect(result.traversal.truncatedCandidates).toBeGreaterThan(0);
        expect(result.traversal.unresolvedCandidates).toBe(3);
    }
    const cycle = new HeapGraph(snapshot('storm-3', extra)).report(before);
    expect(cycle.traversal.truncatedCandidates).toBe(0);
    expect(cycle.traversal.unresolvedCandidates).toBe(3);
    for (const limits of [{ nodes: 1 }, { edges: 1 }, { depth: 9 }, { unknown: 1 }, { visits: 0 }, { candidates: 0.5 }]) {
        expect(() => new HeapGraph(snapshot('warm'), limits)).toThrow();
    }
});

test('identity and phase checks reject unrelated processes and reversed or skipped captures', () => {
    const before = new HeapGraph(snapshot('warm'));
    for (const phase of ['warm', 'recovered']) expect(() => new HeapGraph(snapshot(phase)).report(before)).toThrow('Unexpected capture sequence');
    expect(() => new HeapGraph(snapshot('storm-3', [], [], '456:12345678-1234-1234-1234-123456789abc')).report(before)).toThrow('Snapshot run mismatch');
    expect(() => new HeapGraph(snapshot('warm', [], [], 'private-not-a-run-id'))).toThrow();
    const missing = snapshot('warm'); missing.strings[missing.strings.indexOf(marker)] = 'unmarked';
    expect(() => new HeapGraph(missing)).toThrow('Missing explicit diagnostic markers');
    const missingPhase = snapshot('warm'); missingPhase.strings[missingPhase.strings.indexOf(captureMarker)] = 'uncaptured';
    expect(() => new HeapGraph(missingPhase)).toThrow('Missing capture phase');
});

test('bounded candidate selection prioritizes application objects before hidden runtime nodes', () => {
    const before = new HeapGraph(snapshot('warm', [object(20, [], 'SocketServer')]));
    const after = new HeapGraph(snapshot('storm-3', [object(10, [], 'private-hidden', 'hidden'), object(11),
        object(20, [edge(11)], 'SocketServer')]), { candidates: 1 });
    const result = after.report(before);
    expect(result.buckets.find(bucket => bucket.group === 'object:Object' && bucket.category === 'outside-diagnostic-data').addedRetainerHints)
        .toEqual({ 'object:SocketServer:property': 1 });
    expect(result.traversal.truncatedCandidates).toBe(1);
});

test('malformed graph layouts, offsets, IDs and edge types fail rather than guessing', () => {
    const mutations = [
        s => { s.snapshot.meta.node_fields = []; }, s => { s.snapshot.meta.edge_fields = []; },
        s => { s.snapshot.meta.edge_types = []; }, s => { s.snapshot.meta.edge_fields[2] = 'missing'; },
        s => { s.nodes[2] = -1; }, s => { s.nodes[7] = 1; }, s => { s.nodes[4] = -1; },
        s => { s.edges[0] = -1; }, s => { s.edges[0] = 99; }, s => { s.edges[2] = 1; },
        s => { s.edges[2] = 99999; }, s => { s.edges[1] = -1; }, s => { s.edges[1] = 99999; },
        s => { s.edges.push(0); }, s => { s.nodes[4] = 1; },
        s => { s.snapshot.meta.edge_types[0][0] = 'private-unknown-kind'; },
        s => { s.strings[s.strings.indexOf('warm')] = 'unknown-phase'; },
        s => { s.nodes[5] = 0; },
    ];
    for (const mutate of mutations) { const data = snapshot('warm'); mutate(data); expect(() => new HeapGraph(data)).toThrow(); }
});
