'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { compare } = require('./recovery-heap-summary.cjs');

// This marker identifies only tool-created records, without introducing a new
// root/reference. Reachable data is NOT a dominator/retained-size calculation.
const marker = '__redwebRecoveryDiagnostic';
const captureMarker = '__redwebRecoveryCapture';
const phases = ['warm', 'storm-3', 'recovered'];
const LIMITS = Object.freeze({ nodes: 250000, edges: 1500000, candidates: 2000, visits: 100000,
    edgeVisits: 400000, perCandidateNodes: 2048, perCandidateEdges: 4096, depth: 8 });
const { HeapSnapshotGraph } = require('./HeapSnapshotGraph.cjs');
const owners = new Set(['object:SocketServer', 'object:ReconnectRoute', 'object:ReconnectHandler',
    'object:SessionRegistry', 'object:RoomRegistry', 'object:RouteRuntime', 'object:ConnectionRuntime',
    'object:WebSocket', 'object:WebSocketServer', 'object:Socket', 'object:Promise', 'object:Timeout']);

class HeapGraph extends HeapSnapshotGraph {
    constructor(snapshot, limits = {}) {
        const resolvedLimits = { ...LIMITS, ...limits };
        for (const [name, value] of Object.entries(resolvedLimits)) {
            assert.ok(Object.hasOwn(LIMITS, name) && Number.isSafeInteger(value) && value > 0 && value <= LIMITS[name]);
        }
        super(snapshot, resolvedLimits);
        this.marked = new Set(this.nodes.flatMap((node, index) => node.out.some(edge => edge.kind === 'property' && edge.name === marker) ? [index] : []));
        assert.ok(this.marked.size > 0, 'Missing explicit diagnostic markers');
        const runIds = new Set(), captures = new Set();
        for (const index of this.marked) for (const edge of this.nodes[index].out) {
            if (edge.kind !== 'property' || ![marker, captureMarker].includes(edge.name)) continue;
            const value = this.nodes[edge.target];
            assert.equal(value.type, 'string');
            if (edge.name === marker) {
                assert.match(value.name, /^\d+:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
                runIds.add(value.name);
            } else { assert.ok(phases.includes(value.name)); captures.add(value.name); }
        }
        assert.equal(runIds.size, 1, 'Mixed diagnostic run markers');
        assert.ok(captures.size > 0, 'Missing capture phase');
        this.runId = [...runIds][0];
        this.phase = phases.filter(phase => captures.has(phase)).pop();
        this.data = new Set(this.marked);
        const pending = [...this.marked];
        for (let i = 0; i < pending.length; i++) {
            for (const edge of this.nodes[pending[i]].out) {
                const target = this.nodes[edge.target];
                const ordinary = target.type === 'object' && ['Object', 'Array'].includes(target.name);
                const ownData = edge.kind === 'element' || (edge.kind === 'property' && !['__proto__', marker].includes(edge.name));
                const storage = edge.kind === 'internal' && ['elements', 'properties'].includes(edge.name) && target.type === 'array';
                if (((ownData && ordinary) || storage) && !this.data.has(edge.target)) {
                    this.data.add(edge.target); pending.push(edge.target);
                }
            }
        }
    }

    // A bounded nearest-owner hint, not an exclusive-retention proof. Traverse
    // strong incoming edges only; return no arbitrary names or snapshot IDs.
    retainer(index, budget) {
        const seen = new Set([index]);
        const pending = [{ index, depth: 0, edge: 'self' }];
        let edges = 0, depthLimited = false;
        for (let i = 0; i < pending.length; i++) {
            if (i >= this.limits.perCandidateNodes || budget.visits >= this.limits.visits) return { hint: 'unresolved', truncated: true };
            budget.visits++;
            const current = pending[i];
            if (current.depth > 0 && this.data.has(current.index)) return { hint: `diagnostic-data:${current.edge}`, truncated: false };
            const node = this.nodes[current.index];
            if (current.depth > 0 && owners.has(node.group)) return { hint: `${node.group}:${current.edge}`, truncated: false };
            if (current.depth >= this.limits.depth) { depthLimited ||= node.incoming.length > 0; continue; }
            for (const edge of node.incoming) {
                if (edges >= this.limits.perCandidateEdges || budget.edgeVisits >= this.limits.edgeVisits) return { hint: 'unresolved', truncated: true };
                edges++; budget.edgeVisits++;
                if (!seen.has(edge.source)) {
                    seen.add(edge.source);
                    pending.push({ index: edge.source, depth: current.depth + 1, edge: edge.kind });
                }
            }
        }
        return { hint: 'unresolved', truncated: depthLimited };
    }

    report(previous) {
        assert.equal(this.runId, previous.runId, 'Snapshot run mismatch');
        assert.equal(phases.indexOf(this.phase), phases.indexOf(previous.phase) + 1, 'Unexpected capture sequence');
        const buckets = {};
        const category = (graph, index) => graph.data.has(index) ? 'diagnostic-data-reachable' : 'outside-diagnostic-data';
        const keys = graph => new Map(graph.nodes.map((node, index) => [node.id, `${category(graph, index)}|${node.group}`]));
        const priorKeys = keys(previous), currentKeys = keys(this);
        const bucketFor = (category, group) => buckets[`${category}|${group}`] ??= { category, group,
            beforeCount: 0, beforeSelfBytes: 0, count: 0, selfBytes: 0, addedCount: 0, addedSelfBytes: 0,
            removedCount: 0, removedSelfBytes: 0, movedInCount: 0, movedOutCount: 0, addedRetainerHints: {} };
        for (const [index, node] of previous.nodes.entries()) {
            const bucket = bucketFor(category(previous, index), node.group);
            bucket.beforeCount++; bucket.beforeSelfBytes += node.size;
            if (!this.ids.has(node.id)) { bucket.removedCount++; bucket.removedSelfBytes += node.size; }
            else if (priorKeys.get(node.id) !== currentKeys.get(node.id)) bucket.movedOutCount++;
        }
        const traversal = { candidates: 0, visits: 0, edgeVisits: 0, unresolvedCandidates: 0, truncatedCandidates: 0 };
        const candidates = [];
        for (const [index, node] of this.nodes.entries()) {
            const partition = category(this, index);
            const added = !previous.ids.has(node.id);
            const bucket = bucketFor(partition, node.group);
            bucket.count++; bucket.selfBytes += node.size;
            if (!added && priorKeys.get(node.id) !== currentKeys.get(node.id)) bucket.movedInCount++;
            if (added) {
                bucket.addedCount++; bucket.addedSelfBytes += node.size;
                if (partition === 'outside-diagnostic-data' && ['object', 'closure', 'hidden'].includes(node.type)) {
                    candidates.push({ index, bucket, priority: ['object', 'closure', 'hidden'].indexOf(node.type) });
                }
            }
        }
        // Inspect application objects before high-volume hidden runtime nodes.
        // Preserve a count of every unvisited candidate when the bound is hit.
        candidates.sort((a, b) => a.priority - b.priority || a.index - b.index);
        for (const { index, bucket } of candidates) {
            const candidate = traversal.candidates < this.limits.candidates
                ? this.retainer(index, traversal) : { hint: 'unresolved', truncated: true };
            traversal.candidates++;
            const { hint, truncated } = candidate;
            if (hint === 'unresolved') traversal.unresolvedCandidates++;
            if (truncated) traversal.truncatedCandidates++;
            bucket.addedRetainerHints[hint] = (bucket.addedRetainerHints[hint] ?? 0) + 1;
        }
        for (const bucket of Object.values(buckets)) {
            bucket.netCount = bucket.count - bucket.beforeCount;
            bucket.netSelfBytes = bucket.selfBytes - bucket.beforeSelfBytes;
            assert.equal(bucket.netCount, bucket.addedCount - bucket.removedCount + bucket.movedInCount - bucket.movedOutCount);
        }
        const grossDeltas = compare(previous.gross, this.gross);
        for (const group of grossDeltas) {
            const partitions = Object.values(buckets).filter(bucket => bucket.group === group.group);
            assert.equal(partitions.reduce((sum, bucket) => sum + bucket.netCount, 0), group.delta.count);
            assert.equal(partitions.reduce((sum, bucket) => sum + bucket.netSelfBytes, 0), group.delta.selfBytes);
        }
        return { diagnosticOnly: true, sameRunMarkerVerified: true, exclusiveOwnershipProven: false,
            fromPhase: previous.phase, toPhase: this.phase, traversal,
            grossDeltas,
            markedRecords: this.marked.size, diagnosticDataNodes: this.data.size,
            removedNodeCount: [...previous.ids].filter(id => !this.ids.has(id)).length,
            buckets: Object.values(buckets).sort((a, b) => `${a.category}|${a.group}`.localeCompare(`${b.category}|${b.group}`)) };
    }
}

if (require.main === module) {
    try {
        assert.equal(process.argv.length, 4);
        for (const filename of process.argv.slice(2)) assert.ok(fs.statSync(filename).size <= 64 * 1024 * 1024);
        const warm = new HeapGraph(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
        const recovered = new HeapGraph(JSON.parse(fs.readFileSync(process.argv[3], 'utf8')));
        const output = JSON.stringify(recovered.report(warm), null, 2);
        assert.ok(Buffer.byteLength(output) <= 1024 * 1024);
        console.log(output);
    } catch {
        console.error('Private heap-graph diagnostic failed.');
        process.exitCode = 1;
    }
}

module.exports = { HeapGraph, marker, captureMarker };
