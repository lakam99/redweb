'use strict';

const assert = require('node:assert/strict');
const { summarize, nodeGroup } = require('./recovery-heap-summary.cjs');
const edgeKinds = new Set(['context', 'element', 'property', 'internal', 'hidden', 'shortcut', 'weak']);

// Shared validated topology. Raw names stay private; consumers must allowlist output.
class HeapSnapshotGraph {
    constructor(snapshot, limits) {
        this.limits = limits;
        const meta = snapshot.snapshot.meta;
        const fields = meta.node_fields;
        const edges = meta.edge_fields;
        assert.ok(Array.isArray(fields) && fields.length > 0 && Array.isArray(snapshot.nodes));
        assert.ok(Array.isArray(edges) && Array.isArray(meta.edge_types) && Array.isArray(snapshot.edges));
        assert.ok(edges.length > 0 && snapshot.nodes.length / fields.length <= this.limits.nodes && snapshot.edges.length / edges.length <= this.limits.edges);
        this.gross = summarize(snapshot); // Reuse numeric/type/string validation and labels.
        const offset = (names, name) => { const found = names.indexOf(name); assert.ok(found >= 0); return found; };
        const nt = offset(fields, 'type'), nn = offset(fields, 'name'), ns = offset(fields, 'self_size');
        const ni = offset(fields, 'id'), nc = offset(fields, 'edge_count');
        const et = offset(edges, 'type'), en = offset(edges, 'name_or_index'), eo = offset(edges, 'to_node');
        assert.ok(Array.isArray(meta.edge_types[et]));
        assert.equal(snapshot.edges.length % edges.length, 0);
        assert.ok(snapshot.nodes.length / fields.length <= this.limits.nodes && snapshot.edges.length / edges.length <= this.limits.edges);
        this.nodes = [];
        this.ids = new Set();
        for (let i = 0; i < snapshot.nodes.length; i += fields.length) {
            const id = snapshot.nodes[i + ni], count = snapshot.nodes[i + nc];
            assert.ok(Number.isSafeInteger(id) && id >= 0 && !this.ids.has(id));
            assert.ok(Number.isSafeInteger(count) && count >= 0);
            this.ids.add(id);
            const type = meta.node_types[nt][snapshot.nodes[i + nt]], name = snapshot.strings[snapshot.nodes[i + nn]];
            this.nodes.push({ id, type, name, group: nodeGroup(type, name), size: snapshot.nodes[i + ns], count, out: [], incoming: [] });
        }
        let cursor = 0;
        for (const [source, node] of this.nodes.entries()) {
            for (let i = 0; i < node.count; i++, cursor += edges.length) {
                const typeIndex = snapshot.edges[cursor + et], target = snapshot.edges[cursor + eo];
                const nameIndex = snapshot.edges[cursor + en];
                assert.ok(Number.isSafeInteger(typeIndex) && typeIndex >= 0 && typeIndex < meta.edge_types[et].length);
                const kind = meta.edge_types[et][typeIndex];
                assert.ok(edgeKinds.has(kind));
                assert.ok(Number.isSafeInteger(target) && target >= 0 && target % fields.length === 0 && target / fields.length < this.nodes.length);
                assert.ok(Number.isSafeInteger(nameIndex) && nameIndex >= 0);
                const indexed = kind === 'element' || kind === 'hidden';
                assert.ok(indexed || typeof snapshot.strings[nameIndex] === 'string');
                const edge = { source, target: target / fields.length, kind, name: indexed ? '' : snapshot.strings[nameIndex] };
                node.out.push(edge);
                if (kind !== 'weak') this.nodes[edge.target].incoming.push(edge);
            }
        }
        assert.equal(cursor, snapshot.edges.length);
    }
}

module.exports = { HeapSnapshotGraph };
