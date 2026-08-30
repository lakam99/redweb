const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DashboardStore } = require('../dist/store');
const { DashboardAuth, credentials } = require('../dist/auth');

test('login admission reopens after the real one-minute window, without clock mocks', { timeout: 65000 }, async t => {
    const store = new DashboardStore(':memory:');
    const auth = new DashboardAuth(store);
    t.after(() => { auth.close(); store.close(); });
    const password = 'test-only-login-window-password';
    store.provision('alice', await credentials(password));
    for (let attempt = 0; attempt < 10; attempt++) assert.equal(await auth.login('same-peer', 'invalid', password), undefined);
    assert.equal(await auth.login('same-peer', 'alice', password), undefined);
    await new Promise(resolve => setTimeout(resolve, 60010));
    const token = await auth.login('same-peer', 'alice', password);
    assert.equal(store.session(token).account, 'alice');
});
