'use strict';

// Creation census only: instruction sizes are neither heap size nor retained
// size. No addresses, source text, arbitrary paths or unknown names leave here.
const assert = require('node:assert/strict');
const path = require('node:path');
const { DeoptimizationCensus } = require('./DeoptimizationCensus.cjs');
const kinds = ['BYTECODE_HANDLER', 'FOR_TESTING', 'BUILTIN', 'REGEXP', 'WASM_FUNCTION',
    'WASM_TO_CAPI_FUNCTION', 'WASM_TO_JS_FUNCTION', 'JS_TO_WASM_FUNCTION', 'C_WASM_ENTRY',
    'INTERPRETED_FUNCTION', 'BASELINE', 'MAGLEV', 'TURBOFAN'];
const header = 'v8-version,12,4,254,21,-node.33,0';
const maxBytes = 16 * 1024 * 1024;

function decode(value) {
    return value.replace(/\\(\\|n|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/g, (_, escape) =>
        escape === '\\' ? '\\' : escape === 'n' ? '\n' : String.fromCharCode(parseInt(escape.slice(1), 16)));
}

function location(label, root) {
    const normalized = decode(label).replaceAll('\\', '/');
    const prefix = `${path.resolve(root).replaceAll('\\', '/')}/`;
    const match = normalized.match(/^(.*?) (.+):(\d+):(\d+)$/);
    if (!match || !/^[\w$ .<>\[\]-]{0,160}$/.test(match[1])) return { source: 'other', name: 'unclassified' };
    let source = match[2];
    if (source.startsWith(prefix)) source = source.slice(prefix.length);
    if (!/^(node:[\w/.-]+|node_modules\/ws\/lib\/[\w-]+\.js|scripts\/realtime-harness\.js|scripts\/diagnostics\/recovery-split-worker\.cjs)$/.test(source)) {
        return { source: 'other', name: 'unclassified' };
    }
    return { source, name: match[1] || '<anonymous>', line: Number(match[3]), column: Number(match[4]) };
}

function summarize(log, root = path.resolve(__dirname, '../..')) {
    assert(typeof log === 'string' && Buffer.byteLength(log) <= maxBytes, 'Invalid or oversized code log');
    assert(log.endsWith('\n'), 'Incomplete code log');
    const lines = log.trimEnd().split(/\r?\n/);
    assert.equal(lines[0], header, 'Unsupported V8 code-log version');
    const events = [];
    const deoptimizations = new DeoptimizationCensus();
    for (const line of lines.slice(1)) {
        assert(!/^(script-source|code-source-info|code-disassemble|feedback-vector),/.test(line), 'Unexpected private source/detail logging');
        assert(!line.startsWith('v8-version,'), 'Multiple V8 isolates in code log');
        const fields = line.split(',');
        if (fields[0] === 'code-move') { deoptimizations.move(fields); continue; }
        if (fields[0] === 'code-deopt') { deoptimizations.deopt(fields, events.length - 1); continue; }
        if (fields[0] !== 'code-creation') continue;
        assert(fields.length === 7 || fields.length === 9, 'Malformed code-creation record');
        const kind = Number(fields[2]), time = Number(fields[3]), bytes = Number(fields[5]);
        assert(/^-?\d+$/.test(fields[2]) && Number.isSafeInteger(kind) && (kind === -2 || (kind >= 0 && kind < kinds.length)), 'Unknown code kind');
        assert(/^\d+$/.test(fields[3]) && Number.isSafeInteger(time) && time >= deoptimizations.lastTime, 'Invalid code timestamp');
        assert(/^\d+$/.test(fields[5]) && Number.isSafeInteger(bytes), 'Invalid instruction size');
        assert(/^0x[\da-f]+$/i.test(fields[4]), 'Invalid code address');
        if (fields.length === 9) assert(/^0x[\da-f]+$/i.test(fields[7]) && ['~', '^', '+', '*', ''].includes(fields[8]), 'Invalid function record');
        const event = { kind: kind === -2 ? 'CALLBACK' : kinds[kind], time, bytes, ...location(fields[6], root) };
        events.push(event);
        deoptimizations.created(fields[4], event);
    }
    const boundary = name => {
        const matches = events.filter(event => event.name === name && event.source === 'scripts/diagnostics/recovery-split-worker.cjs');
        assert.equal(matches.length, 1, 'Missing or repeated native boundary');
        assert.equal(matches[0].kind, 'INTERPRETED_FUNCTION', 'Unexpected boundary tier');
        return events.indexOf(matches[0]);
    };
    const warm = boundary('rwDiagnosticWarmBoundary'), final = boundary('rwDiagnosticFinalBoundary');
    assert(warm < final, 'Reversed code boundaries');
    const selected = events.slice(warm + 1, final);
    const groups = new Map();
    for (const event of selected) {
        const { kind, source, name, line, column } = event;
        const key = JSON.stringify([kind, source, name, line, column]);
        const group = groups.get(key) || { kind, source, name, line, column, creations: 0, instructionBytes: 0 };
        group.creations++;
        group.instructionBytes += event.bytes;
        assert(Number.isSafeInteger(group.instructionBytes), 'Instruction-size sum overflow');
        groups.set(key, group);
    }
    const rows = [...groups.values()].sort((a, b) => b.instructionBytes - a.instructionBytes || JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return { diagnosticOnly: true, retainedSizeProven: false, version: header,
        window: 'after-warm-sample-boundary-to-after-final-sample-boundary',
        boundaryTimesUs: [events[warm].time, events[final].time],
        boundaryInstructionBytes: events[warm].bytes + events[final].bytes,
        totalCreationRecords: events.length, beforeOrAtWarm: warm + 1, afterOrAtFinal: events.length - final,
        intervalCreationRecords: selected.length, rows, deoptimizations: deoptimizations.summary(warm, final) };
}

module.exports = { summarize, location, decode };
