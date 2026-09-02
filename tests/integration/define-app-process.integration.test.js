'use strict';

const { fork } = require('node:child_process');
const path = require('node:path');
const { once } = require('node:events');
const { withTimeout } = require('../helpers/network');

test('native abort reasons retain their identity during constructor rollback', () => {
    // Node 18 DOMException is an Error but is not recognized by isNativeError.
    // A native process avoids Jest's additional JavaScript context boundary.
    const result = require('node:child_process').spawnSync(process.execPath, ['-e', `
        const assert = require('node:assert/strict');
        const { scheduleStartupCleanup, awaitStartupCleanup } = require('./src/StartupCleanup');
        const reason = AbortSignal.abort().reason;
        let cleaned = false;
        assert.equal(reason.name, 'AbortError');
        assert.equal(scheduleStartupCleanup(reason, () => { cleaned = true; }), reason);
        awaitStartupCleanup(reason).then(() => {
            assert.equal(cleaned, true);
        }).catch(error => { console.error(error); process.exitCode = 1; });
    `], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 5000, windowsHide: true });
    expect(result.error).toBeUndefined();
    expect({ status: result.status, signal: result.signal, stderr: result.stderr }).toEqual({ status: 0, signal: null, stderr: '' });
});

test.each(['SIGINT', 'SIGTERM', 'close', 'pending', 'leaked', 'dns-error', 'dns-success', 'numeric-cancel'])
('application owns native process shutdown: %s', async mode => {
    const child = fork(path.resolve(__dirname, '../fixtures/define-app-process.cjs'), [mode], { silent: true, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const exited = once(child, 'exit');
    try {
        const dnsCancellation = ['dns-error', 'dns-success', 'numeric-cancel'].includes(mode);
        if (!dnsCancellation) {
            const [message] = await withTimeout(once(child, 'message'), 'application child startup', 5000);
            expect(message.ready).toBe(true);
            child.send({ action: mode === 'close' ? 'close' : 'signal', signal: mode === 'SIGINT' ? 'SIGINT' : 'SIGTERM' });
        }
        const [code, signal] = await withTimeout(exited, 'application child exit', 5000);
        expect({ code, signal, stderr }).toEqual({ code: mode === 'leaked' ? 1 : 0, signal: null, stderr: '' });
        if (mode !== 'leaked') {
            const result = JSON.parse(stdout.trim());
            expect(result.disposed).toBe(1);
            expect(result.listening).toBe(false);
            expect(result.final).toEqual(result.initial);
            expect(result.lookupStarted).toBe(dnsCancellation);
        }
    } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await withTimeout(exited, 'child rescue exit', 5000);
    }
}, 15000);
