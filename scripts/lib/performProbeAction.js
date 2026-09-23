'use strict';

const assert = require('node:assert/strict');
const { verificationError } = require('./verificationError');

/** One guarded exchange, shared unchanged by the isolated consumer and tests. */
async function performProbeAction(socket, version) {
    let timer, message, error, closed, failure;
    try {
        await new Promise((resolve, reject) => {
            error = value => { failure ||= verificationError(value); reject(failure); };
            closed = () => error(new Error('Packed chat closed before its action completed.'));
            message = raw => {
                if (failure) return;
                try {
                    const event = JSON.parse(String(raw));
                    assert(event && typeof event === 'object' && !Array.isArray(event), 'Malformed packed chat response.');
                    if (event.requestId !== 'probe') return;
                    assert(event.v === version && event.type === 'redweb:result' && event.payload === true,
                        `Unexpected packed chat result: ${JSON.stringify(event)}`);
                    resolve();
                } catch (cause) { error(cause); }
            };
            socket.on('message', message); socket.on('error', error); socket.on('close', closed);
            timer = setTimeout(() => error(new Error('Packed chat action did not complete.')), 5000);
            socket.send(JSON.stringify({ v: version, requestId: 'probe', type: 'redweb:html',
                payload: { kind: 'action', component: 'chat', name: 'join', args: [{ name: 'Packed visitor' }] } }));
        });
        if (failure) throw failure;
    } finally {
        clearTimeout(timer);
        socket.off('message', message); socket.off('error', error); socket.off('close', closed);
    }
}

module.exports = { performProbeAction };
