'use strict';

const fs = require('node:fs');

// Linux /proc/PID/stat fields 1, 3-6 and 22 only. Exclude command names,
// arguments and environment; keep start ticks as text to avoid precision loss.
function parseProcStat(stat) {
    const end = stat.lastIndexOf(')');
    const pid = stat.slice(0, stat.indexOf(' '));
    const fields = stat.slice(end + 2).trim().split(/\s+/);
    const values = [pid, fields[1], fields[2], fields[3], fields[19]];
    if (end < 0 || fields.length < 20 || !/^[A-Za-z]$/.test(fields[0]) ||
        values.some(value => !/^\d+$/.test(value))) throw new Error('Invalid process stat');
    return { pid: Number(pid), state: fields[0], parentPid: Number(fields[1]),
        groupId: Number(fields[2]), sessionId: Number(fields[3]), startTicks: fields[19] };
}

function observeProcess(pid) {
    if (!Number.isInteger(pid) || pid < 1) throw new Error('Expected a positive process ID');
    const observation = { pid, platform: process.platform, observedAt: new Date().toISOString() };
    if (process.platform !== 'linux') return { ...observation, status: 'unsupported' };
    try { return { ...observation, ...parseProcStat(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')) }; }
    catch (error) { return { ...observation, error: error.code || error.message }; }
}

module.exports = { parseProcStat, observeProcess };
