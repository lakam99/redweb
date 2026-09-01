const test = require('node:test');
const assert = require('node:assert/strict');
const { listen, live } = require('./network.cjs');

test('one server action updates both visitors', { timeout: 10000 }, async t => {
    const origin = await listen(t);
    const first = await live(t, origin);
    const second = await live(t, origin);
    await first.patch(patch => patch.html.includes('<output>0</output>'));
    await second.patch(patch => patch.html.includes('<output>0</output>'));
    first.action('increment');
    await first.patch(patch => patch.html.includes('<output>1</output>'));
    await second.patch(patch => patch.html.includes('<output>1</output>'));
    assert.match(await (await fetch(origin)).text(), /<output>1<\/output>/);
});
