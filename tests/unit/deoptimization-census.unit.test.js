'use strict';

const { DeoptimizationCensus } = require('../../scripts/diagnostics/DeoptimizationCensus.cjs');
const { summarize } = require('../../scripts/diagnostics/recovery-code-summary.cjs');
const path = require('node:path');
const event = (time = 1, name = 'connect', kind = 'TURBOFAN') => ({ kind, time, source: 'node:net', name, line: 1, column: 2 });
const deopt = (time = 10, pointer = '0x123', kind = 'dependency-change', reason = 'weak objects') =>
    ['code-deopt', `${time}`, '200', pointer, '-1', '-1', kind, 'private-location', reason];

test('matches creation/move identities, separates dependency invalidation from bailouts, and limits the window', () => {
    const census = new DeoptimizationCensus();
    census.created('0xABC', event());
    census.deopt(deopt(2, '0xabc'), -1);
    census.move(['code-move', '0xabc', '0x123']);
    census.deopt(deopt(), 1);
    census.deopt(deopt(11), 2);
    census.deopt(deopt(12, '0x123', 'deopt-eager', 'wrong map'), 2);
    census.deopt(deopt(13, '0x123', 'deopt-lazy', '(unknown)'), 2);
    census.deopt(deopt(14, '0x123', 'deopt-eager', 'private-reason'), 2);
    census.deopt(deopt(15, '0xabc'), 2); // old address no longer identifies the moved code
    census.deopt(deopt(16, '0x123'), 3);
    const report = census.summary(1, 3);
    expect(report).toMatchObject({ totalEvents: 8, intervalEvents: 6, beforeWarm: 1, atOrAfterFinal: 1,
        intervalUnmatched: 1, intervalUnclassifiedReasons: 1, codeMoves: 1, unmatchedCodeMoves: 0 });
    expect(report.rows.find(row => row.matched && row.reason === 'weak objects')).toMatchObject({ source: 'node:net',
        name: 'connect', kind: 'dependency-change', events: 2, firstTimeUs: 10, lastTimeUs: 11 });
    expect(JSON.stringify(report)).not.toMatch(/0x|private-|200/);
    expect(census.summary(1, 3)).toEqual(report);
});

test('unknown moves clear stale destinations and later creations replace old address identities', () => {
    const census = new DeoptimizationCensus();
    census.created('0x123', event());
    census.move(['code-move', '0x999', '0x123']);
    census.deopt(deopt(2), 1);
    census.created('0x123', event(3, 'replacement'));
    census.deopt(deopt(4), 1);
    census.created('0x123', event(5, 'not-optimized', 'BASELINE'));
    census.deopt(deopt(6), 1);
    expect(census.summary(1, 2)).toMatchObject({ codeMoves: 1, unmatchedCodeMoves: 1, intervalUnmatched: 2 });
    expect(census.summary(1, 2).rows.find(row => row.matched).name).toBe('replacement');
    expect(new DeoptimizationCensus().summary(0, 1).rows).toEqual([]);
});

test.each([
    ['code-move'], ['code-move', 'bad', '0x1'], ['code-move', '0x1', 'bad'],
])('invalid move %# is rejected', fields => expect(() => new DeoptimizationCensus().move(fields)).toThrow('Invalid code move'));

test.each([
    fields => fields.pop(), fields => { fields[1] = '-1'; }, fields => { fields[1] = '1e1'; },
    fields => { fields[1] = '9007199254740992'; }, fields => { fields[2] = '-1'; },
    fields => { fields[2] = 'bad'; }, fields => { fields[3] = 'bad'; },
    fields => { fields[4] = '-2'; }, fields => { fields[4] = 'bad'; },
    fields => { fields[5] = '-2'; }, fields => { fields[5] = 'bad'; },
    fields => { fields[6] = 'invented'; },
])('invalid deoptimization record %# is rejected', mutate => {
    const fields = deopt(); mutate(fields);
    expect(() => new DeoptimizationCensus().deopt(fields, 0)).toThrow();
});

test('out-of-order deoptimizations and malformed native moves fail the full parser', () => {
    const census = new DeoptimizationCensus();
    census.created('0x123', event(11));
    expect(() => census.deopt(deopt(10), 0)).toThrow('timestamp');
    const worker = `${path.resolve(__dirname, '../..').replaceAll('\\', '/')}/scripts/diagnostics/recovery-split-worker.cjs`;
    const header = 'v8-version,12,4,254,21,-node.33,0\n';
    const creation = (name, time, pointer, kind) => `code-creation,JS,${kind},${time},${pointer},2,${name},0x456,~\n`;
    const warm = creation(`rwDiagnosticWarmBoundary ${worker}:20:1`, 1, '0x100', 9);
    const final = creation(`rwDiagnosticFinalBoundary ${worker}:21:1`, 10, '0x200', 9);
    const code = creation('connect node:net:1:2', 2, '0x123', 12);
    const logged = `${deopt(3).join(',')}\n`;
    expect(summarize(header + warm + code + logged + final).deoptimizations.rows[0]).toMatchObject({ matched: true, reason: 'weak objects' });
    expect(() => summarize(header + warm + code + logged + final.replace(',10,', ',2,'))).toThrow('timestamp');
    expect(() => summarize(header + warm + 'code-move,bad,0x1\n' + final)).toThrow('Invalid code move');
});
