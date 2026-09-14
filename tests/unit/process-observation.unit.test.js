'use strict';

const { parseProcStat, observeProcess } = require('../helpers/process-observation');

test.each(['node', 'name with spaces', 'nested (name)'])('process stat captures only structural fields: %s', name => {
    const fields = ['Z', '1', '42', '42', ...Array(15).fill('0'), '9007199254740993'];
    expect(parseProcStat(`123 (${name}) ${fields.join(' ')} 999`)).toEqual({
        pid: 123, state: 'Z', parentPid: 1, groupId: 42, sessionId: 42, startTicks: '9007199254740993',
    });
});

test.each(['', '123 node Z', '123 (node) ZZ 1 2 3', `x (node) R ${Array(19).fill('0').join(' ')}`])
('malformed process stat is rejected: %s', stat => {
    expect(() => parseProcStat(stat)).toThrow('Invalid process stat');
});

test.each([0, -1, NaN, 1.5, '123'])('invalid process ID is rejected before reading: %s', pid => {
    expect(() => observeProcess(pid)).toThrow('Expected a positive process ID');
});

test('native process observation explicitly reports platform support', () => {
    const actual = observeProcess(process.pid);
    expect(actual).toMatchObject({ pid: process.pid, platform: process.platform });
    expect(Number.isFinite(Date.parse(actual.observedAt))).toBe(true);
    if (process.platform === 'linux') {
        expect(actual.state).toMatch(/^[A-Za-z]$/);
        expect(actual.startTicks).toMatch(/^\d+$/);
        expect(observeProcess(2147483647)).toMatchObject({ error: 'ENOENT' });
    } else expect(actual.status).toBe('unsupported');
});
