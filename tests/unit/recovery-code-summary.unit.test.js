'use strict';

const path = require('node:path');
const { summarize, location, decode } = require('../../scripts/diagnostics/recovery-code-summary.cjs');
const root = path.resolve(__dirname, '../..');
const worker = `${root.replaceAll('\\', '/')}/scripts/diagnostics/recovery-split-worker.cjs`;
const version = 'v8-version,12,4,254,21,-node.33,0\n';
const creation = (name, time, bytes = 2, kind = 9) => `code-creation,JS,${kind},${time},0x123,${bytes},${name},0x456,~\n`;
const warm = creation(`rwDiagnosticWarmBoundary ${worker}:20:1`, 10);
const final = creation(`rwDiagnosticFinalBoundary ${worker}:21:1`, 100);

test('census separates creation from retention and excludes native boundaries/startup/shutdown', () => {
    const log = version + creation('startup node:net:1:1', 1) + warm
        + creation('connect node:net:2:3', 11, 100, 12) + creation('connect node:net:2:3', 12, 100, 12)
        + creation('read node:net:3:4', 13, 200, 10) + creation(' node:events:1:1', 14)
        + 'code-move,0x123,0x456\n'
        + 'code-creation,Callback,-2,15,0x789,1,private-value\n'
        + final + creation('shutdown node:net:9:9', 101);
    const report = summarize(log);
    expect(report.retainedSizeProven).toBe(false);
    expect(report.boundaryTimesUs).toEqual([10, 100]);
    expect(report.boundaryInstructionBytes).toBe(4);
    expect(report.totalCreationRecords).toBe(9);
    expect(report.beforeOrAtWarm).toBe(2);
    expect(report.afterOrAtFinal).toBe(2);
    expect(report.intervalCreationRecords).toBe(5);
    expect(report.rows.find(row => row.name === 'connect')).toEqual({ kind: 'TURBOFAN', source: 'node:net',
        name: 'connect', line: 2, column: 3, creations: 2, instructionBytes: 200 });
    expect(report.rows.find(row => row.kind === 'CALLBACK')).toMatchObject({ source: 'other', name: 'unclassified', instructionBytes: 1 });
    expect(report.rows.find(row => row.name === '<anonymous>')).toMatchObject({ source: 'node:events' });
    expect(JSON.stringify(report)).not.toMatch(/private-value|0x123|rwDiagnostic/);
    expect(report).toEqual(summarize(log));
});

test('source classification decodes V8 escapes but publishes only known code locations', () => {
    expect(decode('a\\x2Cb\\u0041\\n\\\\')).toBe('a,bA\n\\');
    for (const source of ['scripts/realtime-harness.js', 'node_modules/ws/lib/websocket.js', 'scripts/diagnostics/recovery-split-worker.cjs']) {
        const absolute = `${root}/${source}`.replaceAll('\\', '\\\\');
        expect(location(`work ${absolute}:3:4`, root)).toEqual({ source, name: 'work', line: 3, column: 4 });
    }
    for (const label of ['secret', 'private file:///secret.js:1:2', 'bad\\nname node:net:1:2', `work ${root}/src/private.js:1:2`]) {
        expect(location(label, root)).toEqual({ source: 'other', name: 'unclassified' });
    }
    expect(summarize(version + warm + final, root).rows).toEqual([]);
});

test.each([
    [null, 'Invalid'], ['x'.repeat(16 * 1024 * 1024 + 1), 'oversized'],
    [version + warm + final.trimEnd(), 'Incomplete'],
    [version.replace('12,4', '13,4') + warm + final, 'Unsupported'],
    [version + version + warm + final, 'Multiple'],
    ...['script-source', 'code-source-info', 'code-disassemble', 'feedback-vector'].map(name => [version + `${name},secret\n` + warm + final, 'private']),
    [version + warm, 'Missing'], [version + warm + warm + final, 'Missing'],
    [version + warm + final.replace(',9,', ',12,'), 'tier'],
    [version + final.replace(',100,', ',1,') + warm, 'Reversed'],
    [version + warm + 'code-creation,broken\n' + final, 'Malformed'],
    ...['13', '-3', '', '1e1', '9007199254740992'].map(kind => [version + warm + creation('work node:net:1:1', 11).replace(',9,', `,${kind},`) + final, 'kind']),
    ...['-1', '', '1e1', '9007199254740992', '9'].map(time => [version + warm + creation('work node:net:1:1', time) + final, 'timestamp']),
    ...['-1', '', '1e1', '9007199254740992'].map(bytes => [version + warm + creation('work node:net:1:1', 11, bytes) + final, 'size']),
    [version + warm + creation('work node:net:1:1', 11).replace('0x123', 'invalid') + final, 'address'],
    [version + warm + creation('work node:net:1:1', 11).replace('0x456', 'invalid') + final, 'function'],
    [version + warm + creation('work node:net:1:1', 11).replace(',~', ',invalid') + final, 'function'],
    [version + warm + creation('work node:net:1:1', 11, Number.MAX_SAFE_INTEGER)
        + creation('work node:net:1:1', 12, 1) + final, 'overflow'],
])('invalid census input %# fails closed', (input, message) => {
    expect(() => summarize(input)).toThrow(message);
});
