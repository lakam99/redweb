const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { listen, connect } = require('./network.cjs');
const { match } = require('../dist/contract.js');

async function rejected(client, type, payload) {
    const closed = once(client.socket, 'close');
    await match.client(client.socket).send(type, payload);
    assert.equal((await client.receive(message => message.type === 'error')).error.code, 'HANDLER_FAILED');
    assert.equal((await closed)[0], 1011);
}

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
    await rejected(unjoined, 'move', { x: 2, y: 3 });
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
    const rejectedClosed = once(resumed.socket, 'close');
    resumed.send({ v: match.version, type: 'move', payload: { x: 'wrong', y: 0 } });
    assert.equal((await resumed.receive(message => message.type === 'error')).error.code, 'INVALID_PAYLOAD');
    assert.equal((await rejectedClosed)[0], 1008);
});

test('joined identities cannot join/resume again and unknown sessions fail closed', { timeout: 10000 }, async t => {
    const origin = await listen(t);
    const url = `${origin.replace('http:', 'ws:')}/match?redwebVersion=${match.version}`;
    for (const type of ['join', 'resume']) {
        const client = await connect(t, url, origin);
        await match.client(client.socket).send('join', { name: 'Ada' });
        const joined = await client.receive(message => message.type === 'state');
        await rejected(client, type, type === 'join' ? { name: 'Replacement' } : { session: joined.payload.session });
    }
    const visitor = await connect(t, url, origin);
    await rejected(visitor, 'resume', { session: require('node:crypto').randomUUID() });
});

test('retained disconnected sessions count toward the bounded session capacity', { timeout: 20000 }, async t => {
    const origin = await listen(t);
    const url = `${origin.replace('http:', 'ws:')}/match?redwebVersion=${match.version}`;
    const sessions = new Set();
    for (let index = 0; index < 100; index++) {
        const client = await connect(t, url, origin);
        await match.client(client.socket).send('join', { name: `player-${index}` });
        const joined = await client.receive(message => message.type === 'state');
        sessions.add(joined.payload.session);
        const closed = once(client.socket, 'close');
        client.socket.close();
        await closed;
    }
    assert.equal(sessions.size, 100);
    const overflow = await connect(t, url, origin);
    await rejected(overflow, 'join', { name: 'overflow' });
    // Capacity rejection does not invalidate a previously issued bearer session.
    const resumed = await connect(t, url, origin);
    const session = sessions.values().next().value;
    await match.client(resumed.socket).send('resume', { session });
    assert.equal((await resumed.receive(message => message.type === 'state')).payload.session, session);
});
