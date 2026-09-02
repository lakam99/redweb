'use strict';

const { fork } = require('node:child_process');
const path = require('node:path');
const { once } = require('node:events');
const { withTimeout } = require('../helpers/network');

test.each(['SIGINT', 'SIGTERM', 'close', 'pending', 'leaked'])
('application owns native process shutdown: %s', async mode => {
    const child = fork(path.resolve(__dirname, '../fixtures/define-app-process.cjs'), [mode], { silent: true, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const exited = once(child, 'exit');
    try {
        const [message] = await withTimeout(once(child, 'message'), 'application child startup', 5000);
        expect(message.ready).toBe(true);
        child.send({ action: mode === 'close' ? 'close' : 'signal', signal: mode === 'SIGINT' ? 'SIGINT' : 'SIGTERM' });
        const [code, signal] = await withTimeout(exited, 'application child exit', 5000);
        expect({ code, signal, stderr }).toEqual({ code: mode === 'leaked' ? 1 : 0, signal: null, stderr: '' });
        if (mode !== 'leaked') {
            const result = JSON.parse(stdout.trim());
            expect(result.disposed).toBe(1);
            expect(result.listening).toBe(false);
            expect(result.final).toEqual(result.initial);
        }
    } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await withTimeout(exited, 'child rescue exit', 5000);
    }
}, 15000);
