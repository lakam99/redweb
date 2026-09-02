'use strict';

// Public client operations only. Browser execution uses native WebSockets,
// AbortControllers and timers; Node integration supplies real ws connections.
async function browserClientCases(api, url, transport = {}) {
    const clients = [];
    let assertions = 0;
    const check = (value, label) => { assertions++; if (!value) throw new Error(label); };
    const bounded = async (promise, label) => {
        let timer;
        try {
            return await Promise.race([promise, new Promise((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 3000);
            })]);
        } finally { clearTimeout(timer); }
    };
    const client = (options = {}, address = url) => {
        const value = new api.RedwebClient(address, { requestTimeoutMs: 1000, ...transport, ...options });
        clients.push(value);
        return value;
    };
    const rejection = (promise, pattern) => promise.then(() => { throw new Error(`Expected rejection ${pattern}`); }, error => {
        check(pattern.test(error.message), `Unexpected rejection: ${error.message}`);
        return error;
    });
    const throws = (operation, pattern) => {
        let error;
        try { operation(); } catch (caught) { error = caught; }
        check(error instanceof Error && pattern.test(error.message), 'Expected synchronous validation error');
    };
    const until = async (condition, label) => {
        const deadline = Date.now() + 3000;
        while (!condition()) {
            if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`);
            await new Promise(resolve => setTimeout(resolve, 5));
        }
    };
    try {
        const queued = client({ version: '1', maxQueueSize: 4, requestTimeoutMs: 1000 });
        const cancelled = new AbortController();
        const pendingAbort = rejection(queued.request('ignore', null, { signal: cancelled.signal }), /aborted/);
        queued.send('notice', { value: 'first' });
        const pendingTimeout = rejection(queued.request('ignore', null, { timeoutMs: 10 }), /timed out/);
        cancelled.abort();
        await pendingAbort;
        await pendingTimeout;
        const stateChanges = [];
        const offState = queued.onStateChange(value => stateChanges.push(value));
        const connection = queued.connect();
        check(queued.connect() === connection, 'Concurrent connect calls share one attempt');
        await bounded(connection, 'queued connection');
        await bounded(queued.connect(), 'already-open connection');
        const delivered = await queued.request('barrier', null);
        check(JSON.stringify(delivered.payload.seen) === '["notice","barrier"]', 'Cancelled and expired queued requests never reached the peer');
        check(stateChanges.includes('connecting') && stateChanges.includes('open'), 'Actual connection transitions delivered');
        offState();
        const abort = new AbortController();
        const pending = rejection(queued.request('ignore', null, { requestId: 'same', signal: abort.signal }), /aborted/);
        await rejection(queued.request('echo', null, { requestId: 'same' }), /already pending/);
        abort.abort();
        await pending;
        const reply = await queued.request('echo', { value: 'reply' }, { requestId: 'same', sequence: 0 });
        check(reply.payload.value === 'reply' && reply.requestId === 'same', 'Aborted request ID can be reused for an actual reply');
        const failure = await rejection(queued.request('fail', null), /Peer rejected/);
        check(failure instanceof api.RedwebProtocolError && failure.code === 'DENIED', 'Wire error rejects with structured protocol error');
        const aborted = AbortSignal.abort();
        await rejection(queued.request('echo', null, { signal: aborted }), /aborted/);
        await rejection(queued.waitFor('echo', { signal: aborted }), /aborted/);
        throws(() => queued.request('echo', null, { timeoutMs: -1 }), /non-negative integer/);
        throws(() => queued.waitFor('echo', { timeoutMs: 0.5 }), /non-negative integer/);
        await rejection(queued.request('', null), /type must/);
        await rejection(queued.waitFor('absent', { timeoutMs: 10 }), /Timed out waiting/);
        const waitAbort = new AbortController();
        const waiting = rejection(queued.waitFor('absent', { signal: waitAbort.signal }), /aborted/);
        waitAbort.abort();
        await waiting;
        const listenerAbort = new AbortController();
        const success = queued.waitFor('echo', { signal: listenerAbort.signal });
        queued.send('echo', 'event');
        check((await success).payload === 'event', 'waitFor resolves from a real wire message');
        listenerAbort.abort();
        const errors = [];
        const offError = queued.onError(error => errors.push(error.message));
        const offBadError = queued.onError(() => { throw new Error('Error observer failed'); });
        const offBad = queued.on('echo', () => { throw new Error('Message observer failed'); });
        const offOther = queued.on('echo', () => {});
        const offString = queued.onAny(() => { throw 'Non-error observer failure'; });
        await queued.request('echo', null);
        check(errors.includes('Message observer failed') && errors.includes('Redweb listener failed.'), 'Listener errors are isolated and normalized');
        offBad(); offBad(); offOther(); offString(); offBadError();
        const unsolicited = queued.waitFor('echo');
        queued.send('echo', 'unsolicited', { requestId: 'no-pending-request' });
        check((await unsolicited).payload === 'unsolicited', 'Unmatched reply IDs still reach ordinary listeners');
        const previous = errors.length;
        queued.send('malformed', null);
        await until(() => errors.length > previous, 'malformed frame notification');
        check(errors.length === previous + 1, 'Malformed JSON reports one error');
        offError();
        const binary = new Promise(resolve => { const off = queued.onBinary(value => { off(); resolve(value); }); });
        queued.sendRaw(new Uint8Array([1, 2, 3]));
        check(JSON.stringify(Array.from(new Uint8Array(await bounded(binary, 'binary reply')))) === '[1,2,3]', 'Native binary frames round-trip without JSON decoding');
        const closing = rejection(queued.request('ignore', null), /Client closed/);
        let closeCode;
        const offClose = queued.onClose(event => { closeCode = event.code; });
        queued.close();
        await closing;
        await until(() => closeCode !== undefined, 'native close event');
        check(closeCode === 1000, 'Graceful close is observable');
        offClose(); queued.close(); queued.dispose(); queued.dispose();
        await rejection(queued.connect(), /disposed/);

        const legacy = client({ maxQueueSize: 2 });
        legacy.send('echo', { value: 'legacy' });
        const legacyReply = legacy.request('echo', 'queued');
        throws(() => legacy.send('overflow', null), /queue is full/);
        await bounded(legacy.connect(), 'legacy connection');
        check((await legacyReply).payload === 'queued', 'Queued legacy request flushes on actual open');
        const legacyError = legacy.waitFor('error');
        legacy.send('legacy-error', null);
        check((await legacyError).error === 'Legacy rejection', 'Legacy error is delivered to the error message group');
        legacy.close();

        const offline = client();
        throws(() => offline.sendRaw('offline'), /not open/);
        await rejection(offline.request('echo', null), /not open/);
        offline.dispose();
        const invalidSocket = client({}, url + '#invalid-websocket-fragment');
        await bounded(rejection(invalidSocket.connect(), /fragment|hash/i), 'invalid native constructor');
        check(invalidSocket.state === 'closed', 'Native WebSocket constructor failure closes the client state');
        const refused = client({}, url.replace('/client', '/refuse'));
        const connectionErrors = [];
        refused.onError(error => connectionErrors.push(error));
        await bounded(rejection(refused.connect(), /closed before opening/), 'refused connection');
        check(connectionErrors.length > 0, 'Real HTTP upgrade refusal reports connection error');
        const exhausted = client({ reconnect: { enabled: true, maxAttempts: 1, initialDelayMs: 10, maxDelayMs: 10, jitter: 0 } }, url.replace('/client', '/refuse'));
        let attempts = 0;
        exhausted.onError(() => attempts++);
        await bounded(rejection(exhausted.connect(), /closed before opening/), 'refused retry');
        await until(() => attempts === 2 && exhausted.state === 'closed', 'bounded refused reconnect');
        check(attempts === 2, 'One automatic retry exhausts the configured retry budget');

        const remote = client({ version: '1' });
        await bounded(remote.connect(), 'remote-close connection');
        const remotePending = rejection(remote.request('ignore', null), /connection closed/);
        remote.send('close', { code: 1008 });
        await remotePending;
        check(remote.state === 'closed', 'Policy close rejects pending requests without reconnecting');

        const reconnect = client({ version: '1', reconnect: { enabled: true, initialDelayMs: 10, maxDelayMs: 10, jitter: 0, maxAttempts: 1 } });
        const states = [];
        reconnect.onStateChange(state => states.push(state));
        await bounded(reconnect.connect(), 'reconnecting client');
        reconnect.send('terminate', null);
        await until(() => states.filter(state => state === 'open').length === 2, 'actual socket reconnection');
        check(states.includes('reconnecting') && (await reconnect.request('echo', 'after')).payload === 'after', 'Abrupt disconnect reconnects and carries new traffic');
        reconnect.close();
        for (const operation of ['close', 'connect']) {
            const scheduled = client({ version: '1', reconnect: { enabled: true, initialDelayMs: 200, maxDelayMs: 200, jitter: 0 } });
            const openings = [];
            scheduled.onStateChange(state => { if (state === 'open') openings.push(state); });
            await bounded(scheduled.connect(), 'scheduled client');
            const scheduledRetry = new Promise(resolve => {
                const off = scheduled.onStateChange(state => { if (state === 'reconnecting') { off(); resolve(); } });
            });
            scheduled.send('terminate', null);
            await bounded(scheduledRetry, 'scheduled retry notification');
            await bounded(Promise.resolve(scheduled[operation]()), 'manual retry operation');
            await new Promise(resolve => setTimeout(resolve, 250));
            check(openings.length === (operation === 'connect' ? 2 : 1), `${operation} cancels the earlier reconnect timer`);
            check(scheduled.state === (operation === 'connect' ? 'open' : 'closed'), `${operation} preserves the requested state after the timer deadline`);
            scheduled.dispose();
        }
        return { assertions };
    } finally {
        for (const value of clients) value.dispose();
    }
}

module.exports = browserClientCases;
