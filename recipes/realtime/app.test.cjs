const test = require('node:test');
const assert = require('node:assert/strict');
const { listen, live } = require('./network.cjs');

test('one server action updates both visitors', { timeout: 10000 }, async t => {
    const origin = await listen(t);
    const first = await live(t, origin);
    const second = await live(t, origin);
    await first.state('count', value => value === '0');
    await second.state('count', value => value === '0');
    first.action('increment');
    await first.state('count', value => value === '1');
    await second.state('count', value => value === '1');
    assert.match(await (await fetch(origin)).text(), /data-rw-state="count">1</);
});
