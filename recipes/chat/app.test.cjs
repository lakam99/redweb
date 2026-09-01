const test = require('node:test');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const { listen, live, connect } = require('./network.cjs');
const { createChatroomPage, chatInputs } = require('../dist/chatroom.js');

test('the standalone canonical chat reports an occupied default port', { timeout: 10000 }, async t => {
    const net = require('node:net');
    const { spawnSync } = require('node:child_process');
    const occupied = net.createServer(socket => socket.destroy());
    t.after(() => new Promise(resolve => occupied.close(resolve)));
    occupied.listen(8080, '0.0.0.0');
    try { await once(occupied, 'listening'); }
    catch (error) { assert.equal(error.code, 'EADDRINUSE'); } // An existing listener is left untouched.
    const result = spawnSync(process.execPath, ['dist/chatroom.js'], {
        encoding: 'utf8', timeout: 5000, windowsHide: true,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /EADDRINUSE/);
});

test('members join once, exchange messages, and leave presence on disconnect', { timeout: 10000 }, async t => {
    const origin = await listen(t);
    const alice = await live(t, origin);
    const bob = await live(t, origin);
    alice.action('join', [{ name: 'Alice' }], 'chat');
    bob.action('join', [{ name: 'Bob' }], 'chat');
    await alice.patch(patch => patch.html.includes('Online · 2'));
    await bob.patch(patch => patch.html.includes('Online · 2'));
    alice.action('send', [{ message: 'Hello <friends>' }], 'chat');
    await bob.patch(patch => patch.html.includes('Hello &lt;friends&gt;'));
    const closed = once(alice.socket, 'close');
    alice.socket.close();
    await closed;
    await bob.patch(patch => patch.html.includes('Online · 1'));
});

test('identities stay reserved across reconnects and are released by leaving', { timeout: 10000 }, async t => {
    const origin = await listen(t);
    const alice = await live(t, origin);
    const visitor = await live(t, origin);
    alice.action('join', [{ name: ' Ａlice ' }], 'chat');
    await alice.patch(patch => patch.html.includes('Connected as') && patch.html.includes('Alice'));
    visitor.action('join', [{ name: 'ALICE' }], 'chat');
    await visitor.patch(patch => patch.html.includes('already in use'));
    const closed = once(alice.socket, 'close');
    alice.socket.close();
    await closed;
    visitor.send({ v: visitor.config.version, type: 'redweb:html', requestId: 'reserved-name', payload: { kind: 'action', name: 'join', args: [{ name: 'ALICE' }], component: 'chat' } });
    assert.equal((await visitor.receive(message => message.requestId === 'reserved-name')).payload, false);
    const { config } = alice;
    const resumed = await connect(t, `${origin.replace('http:', 'ws:')}${config.socketPath}?pageId=${config.pageId}&redwebVersion=${encodeURIComponent(config.version)}`, origin);
    await resumed.receive(message => message.type === 'redweb:patch' && message.payload.patches.some(patch => patch.html.includes('Online · 1')));
    resumed.send({ v: config.version, type: 'redweb:html', payload: { kind: 'action', name: 'leave', args: [], component: 'chat' } });
    await resumed.receive(message => message.type === 'redweb:patch' && message.payload.patches.some(patch => patch.html.includes('Join the chatroom')));
    visitor.action('join', [{ name: 'Alice' }], 'chat');
    await visitor.patch(patch => patch.html.includes('Connected as') && patch.html.includes('Online · 1'));
});

test('room units bound history/presence, isolate rooms, and make repeated lifecycle calls harmless', () => {
    const Page = createChatroomPage();
    const alice = new Page().chat;
    const bob = new Page().chat;
    const isolated = new (createChatroomPage())().chat;
    assert.equal(alice.send({ message: 'not joined' }), false);
    alice.connected();
    assert.equal(alice.join(chatInputs.join.parse({ name: ' Ａlice ' })), true);
    assert.equal(alice.join({ name: 'Replacement' }), false);
    assert.equal(bob.join({ name: 'ALICE' }), false);
    assert.match(bob.render().toString(), /already in use/);
    assert.equal(bob.join({ name: 'Bob' }), true);
    assert.equal(isolated.join({ name: 'Alice' }), true);
    assert.match(alice.render().toString(), /No messages yet/);
    for (let index = 0; index < 101; index++) assert.equal(alice.send({ message: `message-${index}` }), true);
    assert.equal(bob.messages.length, 100);
    assert.deepEqual(bob.messages[0], { id: 2, sender: 'Alice', text: 'message-1' });
    assert.equal(bob.messages.at(-1).id, 101);
    assert.equal(isolated.messages.length, 0);
    assert.match(bob.render().toString(), /message-100/);
    alice.disconnected();
    alice.disconnected();
    assert.deepEqual(bob.members, ['Bob']);
    assert.equal(alice.send({ message: 'offline' }), false);
    alice.connected();
    assert.deepEqual(bob.members, ['Bob', 'Alice']);
    const visitors = Array.from({ length: 100 }, (_, index) => {
        const member = new Page().chat;
        assert.equal(member.join({ name: `visitor-${index}` }), true);
        return member;
    });
    const rendered = alice.render().toString();
    assert.match(rendered, /Online · 102/);
    assert.match(rendered, /\+2 more/);
    assert.doesNotMatch(rendered, /<li[^>]*>visitor-99<\/li>/);
    visitors.forEach(member => member.disposed());
    alice.leave();
    alice.disposed();
    alice.disposed();
    assert.deepEqual([alice.displayName, alice.feedback, alice.messages, alice.members], ['', '', [], []]);
    assert.deepEqual(bob.members, ['Bob']);
    assert.match(alice.render().toString(), /Join the chatroom/);
    bob.disposed();
    isolated.disposed();
});
