'use strict';

// The same public-API unit cases run against Node's package entrypoint and the
// exact browser ESM. No transport, clock, or module implementation is replaced.
function clientProtocolCases(api) {
    const { createProtocolEnvelope, createLegacyEnvelope, parseMessage, resolveWebSocketUrl, RedwebClient, RedwebProtocolError } = api;
    let assertions = 0;
    const check = (value, label) => { assertions++; if (!value) throw new Error(label); };
    const rejects = (operation, message) => {
        let error;
        try { operation(); } catch (caught) { error = caught; }
        check(error instanceof TypeError && message.test(error.message), `Expected TypeError: ${message}`);
    };
    const equal = (actual, expected) => check(JSON.stringify(actual) === JSON.stringify(expected), 'Public envelope differs');
    equal(createProtocolEnvelope('1', 'move', { x: 1 }), { v: '1', type: 'move', payload: { x: 1 } });
    equal(createProtocolEnvelope('1', 'move', null, { requestId: 'r', sequence: 0 }),
        { v: '1', type: 'move', payload: null, requestId: 'r', sequence: 0 });
    equal(createLegacyEnvelope('move', { x: 1, type: 'old' }), { x: 1, type: 'move' });
    for (const value of [null, 3, ['x']]) equal(createLegacyEnvelope('move', value), { type: 'move', payload: value });
    for (const value of ['', 1, 'x'.repeat(257)]) rejects(() => createLegacyEnvelope(value, null), /type/);
    rejects(() => createProtocolEnvelope('x'.repeat(65), 'move', null), /version/);
    for (const requestId of ['', 3, 'x'.repeat(257)]) rejects(() => createProtocolEnvelope('1', 'move', null, { requestId }), /requestId/);
    for (const sequence of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        rejects(() => createLegacyEnvelope('move', {}, { sequence }), /sequence/);
    }
    const envelope = { v: '1', type: 'move', payload: null, requestId: 'r', sequence: 2 };
    equal(parseMessage(JSON.stringify(envelope), '1'), envelope);
    check(parseMessage(envelope, '1') === envelope, 'Parsing a supplied envelope preserves identity');
    for (const invalid of [null, [], 2, false]) rejects(() => parseMessage(invalid), /invalid Redweb message/);
    for (const invalid of [{}, { type: '' }]) rejects(() => parseMessage(invalid), /type|invalid Redweb message/);
    rejects(() => parseMessage({ ...envelope, v: '2' }, '1'), /different protocol version/);
    for (const invalid of [{ v: '1', type: 'move' }, { ...envelope, error: 'bad' }]) {
        rejects(() => parseMessage(invalid, '1'), /invalid Redweb protocol envelope/);
    }
    for (const invalid of [
        { v: '1', type: 'error', payload: null }, { v: '1', type: 'error', error: null },
        { v: '1', type: 'error', error: 'bad' }, { v: '1', type: 'error', error: { code: '', message: 'bad' } },
        { v: '1', type: 'error', error: { code: 'BAD', message: '' } },
    ]) rejects(() => parseMessage(invalid, '1'), /error|protocol/);
    rejects(() => parseMessage({ ...envelope, requestId: '' }, '1'), /requestId/);
    rejects(() => parseMessage({ ...envelope, sequence: -1 }, '1'), /sequence/);
    const failure = { v: '1', type: 'error', error: { code: 'BAD', message: 'Rejected' } };
    equal(parseMessage(failure, '1'), failure);
    equal(parseMessage({ type: 'legacy', value: 2 }), { type: 'legacy', value: 2 });
    equal(parseMessage({ error: 'legacy failure' }), { error: 'legacy failure' });
    const error = new RedwebProtocolError(failure);
    check(error instanceof Error && error.name === 'RedwebProtocolError' && error.code === 'BAD' && error.message === 'Rejected' && error.envelope === failure, 'Structured protocol error');
    check(resolveWebSocketUrl('/chat', 'https://example.test/base') === 'wss://example.test/chat', 'HTTPS upgrade');
    check(resolveWebSocketUrl('/chat', 'http://example.test/base') === 'ws://example.test/chat', 'HTTP upgrade');
    check(resolveWebSocketUrl('wss://example.test/chat') === 'wss://example.test/chat', 'Absolute WSS');
    rejects(() => resolveWebSocketUrl('http://['), /absolute/);
    rejects(() => resolveWebSocketUrl('ftp://example.test/chat'), /ws: or wss:/);
    rejects(() => new RedwebClient('ws://example.test/?redwebVersion=1', { version: '2' }), /conflicts/);
    for (const options of [
        { maxQueueSize: -1 }, { requestTimeoutMs: 0.5 }, { reconnect: { maxAttempts: -1 } },
        { reconnect: { initialDelayMs: -1 } }, { reconnect: { maxDelayMs: -1 } },
        { reconnect: { factor: 0 } }, { reconnect: { factor: Infinity } },
        { reconnect: { jitter: -1 } }, { reconnect: { jitter: 2 } }, { reconnect: { jitter: Infinity } },
    ]) rejects(() => new RedwebClient('ws://example.test/', options), /must be/);
    for (const options of [{}, { version: '1' }]) {
        const client = new RedwebClient('ws://example.test/?redwebVersion=1', options);
        check(client.version === '1' && client.state === 'idle', 'URL version selection does not open a socket');
        client.dispose();
    }
    const defaults = new RedwebClient('ws://example.test/');
    check(defaults.state === 'idle' && defaults.version === undefined, 'Default constructor remains lazy');
    defaults.dispose();
    return { assertions };
}

module.exports = clientProtocolCases;
