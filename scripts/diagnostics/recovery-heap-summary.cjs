'use strict';

// Diagnostic only. Input snapshots are private; stdout contains only these fixed
// labels and numeric aggregates, never object contents, string values or paths.
const fs = require('node:fs');
const assert = require('node:assert/strict');

const objectNames = new Set([
    'Object', 'Array', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise',
    'WebSocket', 'WebSocketServer', 'Socket', 'TCP', 'HTTPParser',
    'IncomingMessage', 'ServerResponse', 'ClientRequest', 'Server',
    'AbortController', 'AbortSignal', 'Timeout', 'Immediate', 'Buffer',
    'ArrayBuffer', 'Uint8Array', 'Sender', 'Receiver', 'WritableState', 'ReadableState',
    'ReconnectRoute', 'ReconnectHandler', 'SocketServer', 'SessionRegistry',
    'RoomRegistry', 'ConnectionRuntime', 'RouteRuntime', 'OrderedQueue',
]);
const nodeTypes = new Set(['hidden', 'array', 'string', 'object', 'code', 'closure', 'regexp',
    'number', 'native', 'synthetic', 'concatenated string', 'sliced string', 'symbol', 'bigint', 'object shape']);

function nodeGroup(type, name) {
    return type === 'object' && objectNames.has(name) ? `object:${name}`
        : nodeTypes.has(type) ? `type:${type}` : 'type:other';
}

function summarize(snapshot) {
    const { node_fields: fields, node_types: types } = snapshot.snapshot.meta;
    assert.ok(Array.isArray(fields) && Array.isArray(types)
        && Array.isArray(snapshot.nodes) && Array.isArray(snapshot.strings));
    const typeOffset = fields.indexOf('type');
    const nameOffset = fields.indexOf('name');
    const sizeOffset = fields.indexOf('self_size');
    assert.ok(typeOffset >= 0 && nameOffset >= 0 && sizeOffset >= 0 && fields.length > 0);
    assert.ok(Array.isArray(types[typeOffset]));
    assert.equal(snapshot.nodes.length % fields.length, 0);
    const groups = {};
    for (let offset = 0; offset < snapshot.nodes.length; offset += fields.length) {
        const typeIndex = snapshot.nodes[offset + typeOffset];
        const nameIndex = snapshot.nodes[offset + nameOffset];
        assert.ok(Number.isSafeInteger(typeIndex) && typeIndex >= 0 && typeIndex < types[typeOffset].length);
        assert.ok(Number.isSafeInteger(nameIndex) && nameIndex >= 0 && nameIndex < snapshot.strings.length);
        const type = types[typeOffset][typeIndex];
        const name = snapshot.strings[nameIndex];
        assert.ok(typeof type === 'string' && typeof name === 'string');
        const label = nodeGroup(type, name);
        const size = snapshot.nodes[offset + sizeOffset];
        assert.ok(Number.isSafeInteger(size) && size >= 0);
        const group = groups[label] ??= { count: 0, selfBytes: 0 };
        group.count += 1;
        group.selfBytes += size;
        assert.ok(Number.isSafeInteger(group.selfBytes));
    }
    return groups;
}

function compare(warm, recovered) {
    return [...new Set([...Object.keys(warm), ...Object.keys(recovered)])].sort().map(group => {
        const before = warm[group] ?? { count: 0, selfBytes: 0 };
        const after = recovered[group] ?? { count: 0, selfBytes: 0 };
        return { group, warm: before, recovered: after,
            delta: { count: after.count - before.count, selfBytes: after.selfBytes - before.selfBytes } };
    });
}

if (require.main === module) {
    try {
        assert.equal(process.argv.length, 4);
        const warm = summarize(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
        const recovered = summarize(JSON.parse(fs.readFileSync(process.argv[3], 'utf8')));
        console.log(JSON.stringify({ diagnosticOnly: true, groups: compare(warm, recovered) }, null, 2));
    } catch {
        // Do not echo parse errors, which can include raw snapshot string contents.
        console.error('Private heap-summary diagnostic failed.');
        process.exitCode = 1;
    }
}

module.exports = { summarize, compare, nodeGroup };
