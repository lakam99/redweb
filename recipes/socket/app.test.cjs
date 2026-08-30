const test = require('node:test');
const assert = require('node:assert/strict');
const { listen, connect } = require('./network.cjs');

test('a route dispatches the message type to its handler', { timeout: 10000 }, async t => {
    const origin = await listen(t);
    const client = await connect(t, `${origin.replace('http:', 'ws:')}/events`, origin);
    client.send({ type: 'echo', text: 'Hello sockets' });
    assert.deepEqual(await client.receive(message => message.type === 'echo'), { type: 'echo', text: 'Hello sockets' });
    client.send({ type: 'echo', text: 42 });
    await client.receive(message => Boolean(message.error));
});
