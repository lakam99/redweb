const test = require('node:test');
const assert = require('node:assert/strict');
const { listen } = require('./network.cjs');

test('neutral application foundation serves real HTML and CSS', { timeout: 10000 }, async t => {
    const origin = await listen(t);
    const response = await fetch(origin);
    assert.equal(response.status, 200);
    const document = await response.text();
    assert.match(document, /<h1>Redweb is ready\.<\/h1>/);
    const css = document.match(/<link rel="stylesheet" href="([^"]+)"/)[1];
    const stylesheet = await fetch(`${origin}${css}`);
    assert.equal(stylesheet.status, 200);
    assert.match(await stylesheet.text(), /\.home/);
});
