'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { HeapSnapshotGraph } = require('./HeapSnapshotGraph.cjs');
const { MAX_BYTES } = require('./ClientHeapCapture.cjs');

// Fixed labels only. Function names and arbitrary properties are never emitted.
const codeNames = new Set(['system / Code', 'system / InstructionStream', 'system / FeedbackVector',
    'system / FeedbackCell', 'system / BytecodeArray', 'system / SharedFunctionInfo',
    'system / UncompiledDataWithoutPreparseData', 'system / UncompiledDataWithPreparseData',
    '(code)', '(code deopt data)', '(code relocation info)', '(source position table)',
    '(bytecode offset table)', '(constant pool)', '(handler table)', '(feedback)', '(dependent code)']);
const rootNames = new Set(['(GC roots)', '(Stack roots)', '(Handle scope)', '(Global handles)',
    '(Strong roots)', '(Builtins)', '(Compilation cache)', '(Weak collections)']);
const LIMITS = { nodes: 250000, edges: 1500000, pathDepth: 32 };

function summarizePaths(rows, maximum = 128) {
    assert(Number.isSafeInteger(maximum) && maximum > 0 && maximum <= 128);
    const totals = new Map();
    for (const row of rows) {
        const key = JSON.stringify([row.category, row.cohort, row.status]);
        if (!totals.has(key)) totals.set(key, { category: row.category, cohort: row.cohort, status: row.status, count: 0, selfBytes: 0 });
        const total = totals.get(key);
        total.count += row.count; total.selfBytes += row.selfBytes;
    }
    // Keep all numeric totals, but only bounded detailed examples. Prefer added
    // code and then larger shallow-size groups; omitted paths are never hidden.
    const ordered = [...rows].sort((a, b) => a.cohort.localeCompare(b.cohort) || b.selfBytes - a.selfBytes);
    return { codePathTotals: [...totals.values()], pathGroupCount: rows.length,
        omittedPathGroups: Math.max(0, rows.length - maximum), codePaths: ordered.slice(0, maximum) };
}

function category(node) {
    if (node.type === 'code' && codeNames.has(node.name)) return node.name;
    if (node.type === 'synthetic' && rootNames.has(node.name)) return node.name;
    return node.group;
}

class HeapCodeComparison extends HeapSnapshotGraph {
    constructor(snapshot, limits = {}) {
        const resolved = { ...LIMITS, ...limits };
        for (const [key, value] of Object.entries(resolved)) {
            assert(Object.hasOwn(LIMITS, key) && Number.isSafeInteger(value) && value > 0 && value <= LIMITS[key]);
        }
        super(snapshot, resolved);
        assert(this.nodes.length > 0 && this.nodes[0].type === 'synthetic' && this.nodes[0].name === '', 'Unsupported snapshot root');
        // Single O(nodes + edges) BFS; no repeated per-candidate graph searches.
        this.parents = new Map([[0, null]]);
        const queue = [0];
        for (let cursor = 0; cursor < queue.length; cursor++) {
            for (const edge of this.nodes[queue[cursor]].out) {
                if (edge.kind === 'weak' || edge.kind === 'shortcut' || this.parents.has(edge.target)) continue;
                this.parents.set(edge.target, edge);
                queue.push(edge.target);
            }
        }
    }

    rootPath(index) {
        if (!this.parents.has(index)) return { status: 'unreachable-in-filtered-graph', path: [] };
        const result = [];
        let cursor = index;
        while (cursor !== 0) {
            if (result.length >= this.limits.pathDepth) return { status: 'depth-truncated', path: [] };
            const edge = this.parents.get(cursor);
            result.push({ category: category(this.nodes[cursor]), edge: edge.kind });
            cursor = edge.source;
        }
        return { status: 'root-path', path: result.reverse() };
    }

    compare(previous) {
        const before = new Map(previous.nodes.map(node => [node.id, node]));
        const buckets = new Map();
        const bucketFor = label => {
            if (!buckets.has(label)) buckets.set(label, { category: label, beforeCount: 0, beforeSelfBytes: 0,
                afterCount: 0, afterSelfBytes: 0, addedCount: 0, addedSelfBytes: 0, removedCount: 0, removedSelfBytes: 0,
                survivorBeforeCount: 0, survivorBeforeSelfBytes: 0, survivorAfterCount: 0, survivorAfterSelfBytes: 0 });
            return buckets.get(label);
        };
        for (const node of previous.nodes) {
            const bucket = bucketFor(category(node));
            bucket.beforeCount++; bucket.beforeSelfBytes += node.size;
            if (this.ids.has(node.id)) { bucket.survivorBeforeCount++; bucket.survivorBeforeSelfBytes += node.size; }
            else { bucket.removedCount++; bucket.removedSelfBytes += node.size; }
        }
        const paths = new Map();
        for (const [index, node] of this.nodes.entries()) {
            const bucket = bucketFor(category(node));
            bucket.afterCount++; bucket.afterSelfBytes += node.size;
            const survived = before.has(node.id);
            if (survived) { bucket.survivorAfterCount++; bucket.survivorAfterSelfBytes += node.size; }
            else { bucket.addedCount++; bucket.addedSelfBytes += node.size; }
            if (node.type !== 'code') continue;
            const route = this.rootPath(index);
            const key = JSON.stringify([bucket.category, survived, route]);
            if (!paths.has(key)) paths.set(key, { category: bucket.category, cohort: survived ? 'surviving' : 'added', ...route, count: 0, selfBytes: 0 });
            const row = paths.get(key);
            row.count++; row.selfBytes += node.size;
        }
        for (const bucket of buckets.values()) {
            bucket.deltaSelfBytes = bucket.afterSelfBytes - bucket.beforeSelfBytes;
            assert.equal(bucket.deltaSelfBytes, bucket.addedSelfBytes - bucket.removedSelfBytes
                + bucket.survivorAfterSelfBytes - bucket.survivorBeforeSelfBytes);
            assert.equal(bucket.afterCount - bucket.beforeCount, bucket.addedCount - bucket.removedCount
                + bucket.survivorAfterCount - bucket.survivorBeforeCount);
        }
        return { diagnosticOnly: true, retainedSizeProven: false, shortestFilteredPathsOnly: true,
            categories: [...buckets.values()].sort((a, b) => a.category.localeCompare(b.category)),
            ...summarizePaths([...paths.values()]) };
    }
}

function compareFiles(directory, captures) {
    assert.equal(captures.length, 2);
    assert.match(captures[0].identity, /^\d+:[a-f0-9-]{36}$/);
    const graphs = captures.map((capture, index) => {
        assert.equal(capture.identity, captures[0].identity);
        assert.equal(capture.pid, captures[0].pid);
        assert(capture.identity.startsWith(`${capture.pid}:`));
        assert.equal(capture.node, 'v22.21.0');
        assert.equal(capture.v8, '12.4.254.21-node.33');
        assert.equal(capture.phase, ['warm', 'storm-5'][index]);
        assert.equal(capture.filename, `client-${capture.phase}.heapsnapshot`);
        const filename = path.join(directory, capture.filename);
        assert(capture.bytes > 0 && capture.bytes <= MAX_BYTES && fs.statSync(filename).size === capture.bytes);
        const bytes = fs.readFileSync(filename);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), capture.sha256);
        return new HeapCodeComparison(JSON.parse(bytes.toString('utf8')));
    });
    return graphs[1].compare(graphs[0]);
}

function analyzeReport(reportFile, directory) {
    assert(fs.statSync(reportFile).size <= 2 * 1024 * 1024);
    const bytes = fs.readFileSync(reportFile);
    const original = JSON.parse(bytes.toString('utf8'));
    const comparison = compareFiles(directory, original.heapCaptures);
    const analyzerHashes = Object.fromEntries(['HeapCodeComparison.cjs', 'HeapSnapshotGraph.cjs',
        'ClientHeapCapture.cjs', 'recovery-heap-summary.cjs'].map(filename => [filename,
        createHash('sha256').update(fs.readFileSync(path.join(__dirname, filename))).digest('hex')]));
    const report = { diagnosticOnly: true, offlineReanalysis: true,
        originalRunReportedSuccess: original.deliveryAndCleanupPassed === true,
        originalReportSHA256: createHash('sha256').update(bytes).digest('hex'), analyzerHashes, comparison };
    assert(Buffer.byteLength(JSON.stringify(report)) <= 1024 * 1024);
    return report;
}

if (require.main === module) {
    try {
        assert.equal(process.argv.length, 5);
        const result = analyzeReport(process.argv[2], process.argv[3]);
        fs.writeFileSync(process.argv[4], `${JSON.stringify(result)}\n`, { flag: 'wx' });
        console.log('Private heap reanalysis saved; original evidence unchanged.');
    } catch {
        console.error('Private heap reanalysis failed; raw details withheld.');
        process.exitCode = 1;
    }
}

module.exports = { HeapCodeComparison, category, compareFiles, summarizePaths, analyzeReport };
