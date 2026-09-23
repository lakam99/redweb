const test = require('node:test');
const assert = require('node:assert/strict');
const { listen } = require('./network.cjs');

test('pages share a layout, serve CSS, and require no browser runtime', { timeout: 10000 }, async t => {
    const origin = await listen(t);
    for (const route of ['/', '/about']) {
        const response = await fetch(`${origin}${route}`);
        assert.equal(response.status, 200);
        const document = await response.text();
        assert.match(document, /<nav>/);
        assert.doesNotMatch(document, /<script/);
        const css = document.match(/<link rel="stylesheet" href="([^"]+)"/)[1];
        const stylesheet = await fetch(`${origin}${css}`);
        assert.equal(stylesheet.status, 200);
        assert.match(await stylesheet.text(), /\.home/);
    }
    assert.equal((await fetch(`${origin}/missing`)).status, 404);
});
