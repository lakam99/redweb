const test = require('node:test');
const { once } = require('node:events');
const { listen, live } = require('./network.cjs');

test('members join once, exchange messages, and leave presence on disconnect', { timeout: 10000 }, async t => {
    const origin = await listen(t);
    const alice = await live(t, origin);
    const bob = await live(t, origin);
    alice.action('join', [{ name: 'Alice' }], 'chat');
    bob.action('join', [{ name: 'Bob' }], 'chat');
    await alice.state('presence', value => value.includes('Alice') && value.includes('Bob'), 'chat');
    await bob.state('presence', value => value.includes('Alice') && value.includes('Bob'), 'chat');
    alice.action('send', [{ message: 'Hello <friends>' }], 'chat');
    await bob.state('messages', value => value.includes('Hello &lt;friends&gt;'), 'chat');
    const closed = once(alice.socket, 'close');
    alice.socket.close();
    await closed;
    await bob.state('presence', value => !value.includes('Alice') && value.includes('Bob'), 'chat');
});
