'use strict';

const test = globalThis.test ?? require('node:test').test;
const expect = globalThis.expect ?? require('expect').expect;

const { HeapCodeComparison, category, compareFiles, summarizePaths } = require('../../scripts/diagnostics/HeapCodeComparison.cjs');
const { ClientHeapCapture } = require('../../scripts/diagnostics/ClientHeapCapture.cjs');

function snapshot(records) {
    const types = ['synthetic', 'code', 'object'];
    const kinds = ['internal', 'weak', 'shortcut', 'property'];
    const strings = [''];
    const intern = name => { strings.push(name); return strings.length - 1; };
    const nodes = [], edges = [];
    for (const [id, name, size, links, type = 'code'] of records) {
        nodes.push(types.indexOf(type), intern(name), id, size, links.length);
        for (const [target, kind = 'internal'] of links) edges.push(kinds.indexOf(kind), intern('private-token'), records.findIndex(node => node[0] === target) * 5);
    }
    return { snapshot: { meta: { node_fields: ['type', 'name', 'id', 'self_size', 'edge_count'], node_types: [types],
        edge_fields: ['type', 'name_or_index', 'to_node'], edge_types: [kinds] } }, nodes, edges, strings };
}

test('same-ID survivors reconcile size and category changes with added and removed code', () => {
    const previous = new HeapCodeComparison(snapshot([[1, '', 0, [[2], [3]], 'synthetic'],
        [2, 'system / Code', 10, []], [3, 'private-function', 20, []]]));
    const current = new HeapCodeComparison(snapshot([[1, '', 0, [[2], [4]], 'synthetic'],
        [2, 'system / FeedbackVector', 30, [[1]]], [4, 'system / Code', 40, []]]));
    const report = current.compare(previous);
    expect(report.retainedSizeProven).toBe(false);
    expect(report.categories.find(row => row.category === 'system / Code')).toMatchObject({
        beforeSelfBytes: 10, afterSelfBytes: 40, survivorBeforeSelfBytes: 10, survivorAfterSelfBytes: 0, addedSelfBytes: 40, deltaSelfBytes: 30 });
    expect(report.categories.find(row => row.category === 'type:code')).toMatchObject({ removedCount: 1, removedSelfBytes: 20 });
    expect(report.categories.find(row => row.category === 'system / FeedbackVector')).toMatchObject({ survivorAfterCount: 1, survivorAfterSelfBytes: 30 });
    expect(report.codePaths).toHaveLength(2);
    expect(JSON.stringify(report)).not.toMatch(/private-|private-function/);
    expect(current.compare(previous)).toEqual(report);
});

test('root BFS excludes weak/shortcut-only paths, handles cycles, aggregates paths and reports truncation', () => {
    const input = snapshot([[1, '', 0, [[2], [4, 'weak'], [5, 'shortcut']], 'synthetic'],
        [2, '(GC roots)', 0, [[3]], 'synthetic'], [3, 'system / Code', 8, [[1], [6], [7]]],
        [4, 'system / Code', 8, []], [5, 'system / Code', 8, []],
        [6, 'system / Code', 8, []], [7, 'system / Code', 8, []]]);
    const graph = new HeapCodeComparison(input);
    expect(graph.rootPath(0)).toEqual({ status: 'root-path', path: [] });
    expect(graph.rootPath(2)).toEqual({ status: 'root-path', path: [
        { category: '(GC roots)', edge: 'internal' }, { category: 'system / Code', edge: 'internal' }] });
    expect(graph.rootPath(3).status).toBe('unreachable-in-filtered-graph');
    expect(graph.rootPath(4).status).toBe('unreachable-in-filtered-graph');
    expect(new HeapCodeComparison(input, { pathDepth: 1 }).rootPath(2)).toEqual({ status: 'depth-truncated', path: [] });
    expect(graph.compare(graph).codePaths.find(row => row.status === 'unreachable-in-filtered-graph').count).toBe(2);
    expect(category({ type: 'object', name: 'system / Code', group: 'type:object' })).toBe('type:object');
});

test('unsupported roots, invalid budgets and malformed edges fail closed', () => {
    const input = snapshot([[1, '', 0, [], 'synthetic']]);
    for (const limits of [{ nodes: 0 }, { edges: 1500001 }, { pathDepth: 0.1 }, { unknown: 1 }]) {
        expect(() => new HeapCodeComparison(input, limits)).toThrow();
    }
    expect(() => new HeapCodeComparison(snapshot([]))).toThrow('Unsupported snapshot root');
    expect(() => new HeapCodeComparison(snapshot([[1, 'private-root', 0, [], 'synthetic']]))).toThrow('Unsupported snapshot root');
    expect(() => new HeapCodeComparison(snapshot([[1, '', 0, []]]))).toThrow('Unsupported snapshot root');
    expect(() => new HeapCodeComparison(snapshot([[1, '', 0, [[2]], 'synthetic']]))).toThrow();
});

test('capture configuration, sequence and comparison identity fail closed', async () => {
    expect(() => new ClientHeapCapture('relative')).toThrow();
    const root = require('node:path').resolve(__dirname);
    for (const limit of [0, 0.5, 64 * 1024 * 1024 + 1]) expect(() => new ClientHeapCapture(root, limit)).toThrow();
    await expect(new ClientHeapCapture(root).capture('storm-5')).rejects.toThrow('Invalid heap capture sequence');
    expect(() => compareFiles(root, [])).toThrow();
    expect(() => compareFiles(root, [{ identity: 'private' }, {}])).toThrow();
});

test('large path summaries keep complete numeric totals and explicitly bounded detailed examples', () => {
    const rows = Array.from({ length: 3000 }, (_, index) => ({ category: '(code deopt data)',
        cohort: index === 0 ? 'surviving' : 'added', status: 'root-path', count: 1, selfBytes: index,
        path: Array.from({ length: 32 }, () => ({ category: 'type:code', edge: 'internal' })) }));
    const report = summarizePaths(rows);
    expect(report.codePaths).toHaveLength(128);
    expect(report.pathGroupCount).toBe(3000);
    expect(report.omittedPathGroups).toBe(2872);
    expect(report.codePaths[0].selfBytes).toBe(2999);
    expect(report.codePathTotals.reduce((sum, row) => sum + row.count, 0)).toBe(3000);
    expect(report.codePathTotals.reduce((sum, row) => sum + row.selfBytes, 0)).toBe(2999 * 3000 / 2);
    expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThan(1024 * 1024);
    expect(summarizePaths(rows, 1).omittedPathGroups).toBe(2999);
    expect(() => summarizePaths(rows, 0)).toThrow();
    expect(category({ type: 'code', name: '(code deopt data)' })).toBe('(code deopt data)');
});
