'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');

// The coordinator and workers use separate POSIX groups. The outer test owner
// independently checks/reaps the exact workers registered by its coordinator.
async function cleanupWorkers(directory) {
    const records = fs.readFileSync(path.join(directory, 'workers.ndjson'), 'utf8').trim().split('\n');
    const results = await Promise.allSettled(records.map(async record => {
        const { pid, role } = JSON.parse(record);
        assert(Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid);
        assert(['server', 'client'].includes(role));
        const alive = () => {
            try { process.kill(pid, 0); return true; }
            catch (error) { if (error.code === 'ESRCH') return false; throw error; }
        };
        if (!alive()) return { pid, role };
        try { process.kill(process.platform === 'win32' ? pid : -pid, 'SIGKILL'); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
        const deadline = Date.now() + 5000;
        while (alive()) {
            assert(Date.now() < deadline, `Registered recovery worker ${pid} did not exit`);
            await delay(10);
        }
        return { pid, role };
    }));
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
    const identities = results.filter(result => result.status === 'fulfilled').map(result => result.value);
    try {
        assert.deepEqual(identities.map(worker => worker.role).sort(), ['client', 'server'], 'Incomplete worker inventory');
        assert.equal(new Set(identities.map(worker => worker.pid)).size, 2, 'Duplicate worker identity');
    } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Registered worker cleanup failed');
}

module.exports = { cleanupWorkers };
