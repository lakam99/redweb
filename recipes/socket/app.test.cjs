const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { listen, connect } = require('./network.cjs');
const { match } = require('../dist/contract.js');

test('join, move and resume use separate validated handlers with isolated server sessions', { timeout: 10000 }, async t => {
    const origin = await listen(t);
    const url = `${origin.replace('http:', 'ws:')}/match?redwebVersion=${match.version}`;
    const first = await connect(t, url, origin);
    const second = await connect(t, url, origin);
    const client = match.client(first.socket);
    await client.send('join', { name: ' Ada ' }, { requestId: 'join-1' });
    const joined = await first.receive(message => message.type === 'state');
    assert.equal(joined.requestId, 'join-1');
    assert.equal(joined.payload.name, 'Ada');
    assert.deepEqual([joined.payload.x, joined.payload.y], [0, 0]);

    const unjoined = await connect(t, url, origin);
    const unjoinedClosed = once(unjoined.socket, 'close');
    await match.client(unjoined.socket).send('move', { x: 2, y: 3 });
    assert.equal((await unjoined.receive(message => message.type === 'error')).error.code, 'HANDLER_FAILED');
    assert.equal((await unjoinedClosed)[0], 1011);
    await match.client(second.socket).send('join', { name: 'Grace' });
    const other = await second.receive(message => message.type === 'state');
    assert.notEqual(other.payload.session, joined.payload.session);

    await client.send('move', { x: 7, y: -3 }, { requestId: 'move-1' });
    assert.deepEqual((await first.receive(message => message.type === 'state')).payload,
        { ...joined.payload, x: 7, y: -3 });
    await assert.rejects(client.send('move', { x: 101, y: 0 }), { code: 'INVALID_PAYLOAD' });
    const closed = once(first.socket, 'close');
    first.socket.close();
    await closed;
    const resumed = await connect(t, url, origin);
    await match.client(resumed.socket).send('resume', { session: joined.payload.session });
    assert.deepEqual((await resumed.receive(message => message.type === 'state')).payload,
        { ...joined.payload, x: 7, y: -3 });

    // Bypass client validation to prove the server independently rejects malformed input.
    const rejected = once(resumed.socket, 'close');
    resumed.send({ v: match.version, type: 'move', payload: { x: 'wrong', y: 0 } });
    assert.equal((await resumed.receive(message => message.type === 'error')).error.code, 'INVALID_PAYLOAD');
    assert.equal((await rejected)[0], 1008);
});
