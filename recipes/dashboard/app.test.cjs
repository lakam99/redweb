const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');
const { WebSocketServer, WebSocket } = require('ws');
const { createApp, databasePath } = require('../dist/app');
const { DashboardStore } = require('../dist/store');
const { DashboardAuth, credentials, sessionToken } = require('../dist/auth');
const { PrivateCards } = require('../dist/cards');
const { live, connect } = require('./network.cjs');

const password = 'test-only-correct-password';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(t, options = {}) {
    const directory = mkdtempSync(join(tmpdir(), 'redweb-private-cards-'));
    const database = join(directory, 'cards.sqlite');
    const store = new DashboardStore(database);
    const secret = await credentials(password);
    store.provision('alice', secret);
    store.provision('bob', secret);
    store.close();
    let app;
    t.after(async () => { await app?.shutdown(); rmSync(directory, { recursive: true, force: true }); });
    async function restart() {
        await app?.shutdown();
        app = createApp({ port: 0, database, ...options });
        if (!app.server.listening) await once(app.server, 'listening');
        return `http://127.0.0.1:${app.server.address().port}`;
    }
    return { database, restart, origin: await restart() };
}

function post(origin, path, values, cookie, suppliedOrigin = origin) {
    return fetch(`${origin}${path}`, {
        method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: suppliedOrigin, ...(cookie ? { Cookie: cookie } : {}) },
        body: new URLSearchParams(values),
    });
}

async function login(origin, account = 'alice') {
    const response = await post(origin, '/login', { account, password });
    assert.equal(response.status, 303);
    const header = response.headers.get('set-cookie');
    assert.match(header, /HttpOnly; SameSite=Strict; Path=\//);
    return header.split(';')[0];
}

async function cardClient(t, origin, cookie) {
    const client = await live(t, origin, { Cookie: cookie });
    const component = client.document.match(/data-rw-component="([^"]+)"/)[1];
    await client.patch(patch => patch.id === 'root');
    const parseCards = html => [...html.matchAll(/data-card-id="([^"]+)"[^>]*><h2>([\s\S]*?)<\/h2>/g)].map(match => ({
        id: match[1], title: match[2].replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&'),
    }));
    return {
        ...client, component,
        add: title => client.action('add', [{ title }], component),
        remove: id => client.action('remove', [{ id }], component),
        items: predicate => client.patch(patch => predicate(parseCards(patch.html))).then(message => parseCards(message.payload.patches.find(patch => predicate(parseCards(patch.html))).html)),
    };
}

test('private live cards: real HTTP, sockets, isolation, reconnect, sign-out and durable restart', async t => {
    const fixtureApp = await fixture(t);
    let { origin } = fixtureApp;
    assert.equal((await fetch(`${origin}/login`)).status, 200);
    assert.equal((await fetch(origin)).status, 401);
    assert.equal((await post(origin, '/login', { account: 'alice', password }, '', 'https://foreign.example')).status, 403);
    assert.equal((await post(origin, '/login', { account: 'alice', password: 'wrong-password-at-least-16' })).status, 401);
    const alice = await login(origin);
    const alice2 = await login(origin);
    const bob = await login(origin, 'bob');
    const page = await fetch(origin, { headers: { Cookie: alice } });
    assert.match(page.headers.get('cache-control'), /private.*no-store/);
    assert.equal(page.headers.get('etag'), null);
    const first = await cardClient(t, origin, alice);
    const second = await cardClient(t, origin, alice2);
    const other = await cardClient(t, origin, bob);
    first.add('Saved <script>alert(1)</script>');
    const [items] = await Promise.all([first.items(value => value.length === 1), second.items(value => value.length === 1)]);
    assert.equal(items[0].title, 'Saved <script>alert(1)</script>');
    const db = new DashboardStore(fixtureApp.database);
    assert.deepEqual(db.list(sessionToken(bob)), []);
    other.remove(items[0].id);
    await delay(50);
    assert.equal(db.list(sessionToken(alice)).length, 1);
    first.action('add', [{ title: 'forged', account: 'bob' }], first.component);
    const invalid = await first.receive(message => message.type === 'error');
    assert.equal(invalid.error.code, 'ACTION_INVALID_INPUT');
    assert.equal(db.list(sessionToken(alice)).length, 1);
    const closed = once(first.socket, 'close'); first.socket.close(); await closed;
    second.add('While disconnected');
    await second.items(value => value.length === 2);
    const config = first.config;
    const reconnect = await connect(t, `${origin.replace('http:', 'ws:')}${config.socketPath}?pageId=${config.pageId}&redwebVersion=${encodeURIComponent(config.version)}`, origin, { Cookie: alice });
    await reconnect.receive(message => message.type === 'redweb:patch' && message.payload.patches.some(patch => patch.html.includes('While disconnected')));
    const deniedLogout = await post(origin, '/logout', {}, alice, 'https://foreign.example');
    assert.equal(deniedLogout.status, 403);
    const aliceClosed = once(reconnect.socket, 'close');
    const secondClosed = once(second.socket, 'close');
    const loggedOut = await post(origin, '/logout', {}, alice);
    assert.equal(loggedOut.status, 303);
    assert.match(loggedOut.headers.get('set-cookie'), /Max-Age=0/);
    await Promise.all([aliceClosed, secondClosed]);
    assert.equal((await fetch(origin, { headers: { Cookie: alice2 } })).status, 401);
    assert.equal(other.socket.readyState, 1);
    assert.equal(db.session(sessionToken(alice)), undefined);
    db.close();
    origin = await fixtureApp.restart();
    const renewed = await login(origin);
    const restored = await fetch(origin, { headers: { Cookie: renewed } });
    const text = await restored.text();
    assert.match(text, /While disconnected/);
    assert.match(text, /&lt;script&gt;/);
    const client = await cardClient(t, origin, renewed);
    client.remove(items[0].id);
    await client.items(value => value.length === 1);
});

test('session expiry closes idle sockets and rejects later HTTP access', async t => {
    const { origin } = await fixture(t, { sessionLifetimeMs: 1200 });
    const cookie = await login(origin);
    const client = await cardClient(t, origin, cookie);
    const [code] = await once(client.socket, 'close');
    assert.equal(code, 1008);
    assert.equal((await fetch(origin, { headers: { Cookie: cookie } })).status, 401);
});

test('store and authentication units use actual SQLite and scrypt, never substitutes', async t => {
    const previousDatabase = process.env.DASHBOARD_DATABASE;
    const previousPort = process.env.PORT;
    try {
        delete process.env.DASHBOARD_DATABASE;
        delete process.env.PORT;
        assert.equal(databasePath(), require('node:path').resolve('data/dashboard.sqlite'));
        assert.throws(() => createApp({ origin: 'ftp://invalid.example' }), /exact/);
    } finally {
        if (previousDatabase === undefined) delete process.env.DASHBOARD_DATABASE; else process.env.DASHBOARD_DATABASE = previousDatabase;
        if (previousPort === undefined) delete process.env.PORT; else process.env.PORT = previousPort;
    }
    const directory = mkdtempSync(join(tmpdir(), 'redweb-store-'));
    const database = join(directory, 'unit.sqlite');
    const store = new DashboardStore(database);
    t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
    await assert.rejects(credentials('short'), /16/);
    const secret = await credentials(password);
    assert.throws(() => store.provision('?', secret), /Invalid/);
    store.provision('alice', secret);
    assert.throws(() => store.provision('alice', secret));
    assert.equal(store.credentials('missing'), undefined);
    assert.throws(() => store.issue('alice', 0));
    const auth = new DashboardAuth(store);
    assert.equal(await auth.login('peer', 'unknown', password), undefined);
    assert.equal(await auth.login('peer', {}, password), undefined);
    const token = await auth.login('peer', 'alice', password);
    assert.equal(store.session(token).account, 'alice');
    assert.equal(sessionToken(`redweb_dashboard=${token}`), token);
    assert.equal(sessionToken(`redweb_dashboard=${token}; redweb_dashboard=${token}`), '');
    assert.equal(sessionToken('redweb_dashboard=invalid'), '');
    assert.equal(store.session('invalid'), undefined);
    assert.throws(() => store.list('invalid'), /expired/);
    assert.throws(() => store.add(token, ''), /Invalid/);
    assert.throws(() => store.add(token, '\u0000'), /Invalid/);
    for (let i = 0; i < 100; i++) store.add(token, `Card ${i}`);
    assert.throws(() => store.add(token, 'Over capacity'), /limit/);
    assert.equal(store.list(token).length, 100);
    store.remove(token, store.list(token)[0].id);
    assert.equal(store.list(token).length, 99);
    for (let i = 1; i < 32; i++) store.issue('alice', 10000);
    assert.throws(() => store.issue('alice', 10000), /existing sessions/);
    assert.equal(store.signOut(token), 'alice');
    assert.equal(store.signOut(token), undefined);
    assert.throws(() => store.remove(token, 'anything'), /expired/);
    for (let i = 0; i < 10; i++) await auth.login('limited', '!', password);
    assert.equal(await auth.login('limited', 'alice', password), undefined);
    store.close(); store.close();
    const raw = new DatabaseSync(database);
    raw.exec('PRAGMA user_version = 2'); raw.close();
    assert.throws(() => new DashboardStore(database), /Unsupported/);
});

test('logout fences password checks in flight; close and admission bounds stop new sessions', async t => {
    const store = new DashboardStore(':memory:');
    t.after(() => store.close());
    store.provision('alice', await credentials(password));
    const auth = new DashboardAuth(store);
    const token = store.issue('alice', 5000);
    const pending = auth.login('peer', 'alice', password);
    store.signOut(token);
    await assert.rejects(pending, /Sign-out occurred/);
    const closing = auth.login('peer', 'alice', password);
    auth.close();
    assert.equal(await closing, undefined);
    assert.equal(await auth.login('peer', 'alice', password), undefined);
    assert.throws(() => new DashboardAuth(store, 0));
    const limited = new DashboardAuth(store);
    const concurrent = Array.from({ length: 5 }, (_, index) => limited.login(`peer-${index}`, 'alice', password));
    assert.equal(await concurrent[4], undefined);
    const issued = await Promise.all(concurrent.slice(0, 4));
    assert.ok(issued.every(Boolean));
    for (let index = 0; index < 1024; index++) await limited.login(`invalid-${index}`, null, null);
    assert.equal(await limited.login('new-peer', 'alice', password), undefined);
    const expiring = store.issue('alice', 100);
    await delay(110);
    assert.equal(store.session(expiring), undefined);
    store.issue('alice', 1000); // Prunes expired rows during issuance.
});

test('subscription cleanup is idempotent across replacement groups and failed callbacks', async t => {
    const store = new DashboardStore(':memory:');
    store.provision('alice', await credentials(password));
    const token = store.issue('alice', 5000);
    const cards = new PrivateCards(store);
    const sockets = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(sockets, 'listening');
    const peers = [];
    t.after(async () => {
        for (const peer of peers) peer.terminate();
        for (const peer of sockets.clients) peer.terminate();
        await new Promise(resolve => sockets.close(resolve)); store.close();
    });
    async function context() {
        const accepted = once(sockets, 'connection');
        const client = new WebSocket(`ws://127.0.0.1:${sockets.address().port}`); peers.push(client);
        const opened = once(client, 'open');
        const [socket] = await accepted;
        await opened;
        const controller = new AbortController();
        return { controller, value: { principal: 'alice', signal: controller.signal, socket, request: { get: name => name === 'cookie' ? `redweb_dashboard=${token}` : undefined } } };
    }
    const original = await context();
    const cleanup = cards.subscribe(original.value, () => {});
    original.controller.abort();
    const replacement = await context();
    let updates = 0;
    const release = cards.subscribe(replacement.value, () => updates++);
    cleanup(); cleanup();
    cards.publish(store.add(token, 'Replacement still registered'));
    assert.equal(updates, 2);
    const broken = await context();
    let fail = false;
    cards.subscribe(broken.value, () => { if (fail) throw new Error('Intentional consumer failure'); });
    fail = true;
    cards.publish(store.add(token, 'Failure isolation'));
    assert.equal(updates, 3);
    const failedInitial = await context();
    assert.throws(() => cards.subscribe(failedInitial.value, () => { throw new Error('Initial callback failure'); }), /Initial/);
    const invalid = await context(); invalid.controller.abort();
    assert.throws(() => cards.subscribe(invalid.value, () => {}), /Sign in/);
    store.signOut(token);
    cards.publish('alice');
    assert.equal(updates, 3);
    assert.throws(() => cards.subscribe(replacement.value, () => {}), /Sign in/);
    release(); cards.publish('missing');
});

test('incomplete HTTP uploads cannot keep shutdown or the database alive indefinitely', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'redweb-drain-'));
    const database = join(directory, 'drain.sqlite');
    let app;
    t.after(async () => { await app?.shutdown(); rmSync(directory, { recursive: true, force: true }); });
    assert.throws(() => createApp({ port: 0, database, sessionLifetimeMs: 0 }), /lifetime/);
    assert.throws(() => createApp({ port: 0, database, origin: 'https://example.com/path' }), /exact/);
    assert.throws(() => createApp({ port: 0, database, origin: 'ftp://example.com' }), /exact/);
    app = createApp({ port: 0, database });
    await once(app.server, 'listening');
    const socket = net.connect(app.server.address().port, '127.0.0.1');
    t.after(() => socket.destroy());
    socket.on('error', () => {});
    await once(socket, 'connect');
    socket.write('POST /login HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 1000\r\n\r\naccount=');
    await delay(30);
    const started = Date.now();
    await app.shutdown();
    assert.ok(Date.now() - started < 2000);
    const reopened = new DashboardStore(database); reopened.close();
});

test('SQLite commits survive abrupt process termination rather than only graceful shutdown', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'redweb-crash-'));
    const database = join(directory, 'crash.sqlite');
    const store = new DashboardStore(database);
    store.provision('alice', await credentials(password));
    const token = store.issue('alice', 60000); store.close();
    const child = spawn(process.execPath, ['-e', `
        const { DashboardStore } = require('./dist/store');
        const db = new DashboardStore(process.argv[1]);
        db.add(process.argv[2], 'Committed before crash');
        process.send('committed');
        setInterval(() => {}, 1000);
    `, database, token], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
        rmSync(directory, { recursive: true, force: true });
    });
    assert.deepEqual(await once(child, 'message'), ['committed', undefined]);
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    const recovered = new DashboardStore(database);
    try { assert.equal(recovered.list(token)[0].title, 'Committed before crash'); }
    finally { recovered.close(); }
});

test('production origin/cookies and malformed forms use real HTTP', async t => {
    const { origin } = await fixture(t, { origin: 'https://dashboard.example' });
    const authenticated = await post(origin, '/login', { account: 'alice', password }, '', 'https://dashboard.example');
    assert.equal(authenticated.status, 303);
    assert.match(authenticated.headers.get('set-cookie'), /; Secure/);
    assert.equal((await post(origin, '/login', { account: 'alice', password: 'x'.repeat(5000) })).status, 400);
    assert.equal((await post(origin, '/logout', {}, '', 'https://dashboard.example')).status, 303);
    assert.equal((await post(origin, '/login', {})).status, 403);
});

test('real administrator and standalone startup commands expose errors and persist accounts', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'redweb-dashboard-cli-'));
    const database = join(directory, 'cli.sqlite');
    let app;
    let child;
    t.after(async () => {
        if (child && child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; }
        await app?.shutdown();
        rmSync(directory, { recursive: true, force: true });
    });
    const env = { ...process.env, DASHBOARD_DATABASE: database, PORT: '0', NODE_ENV: 'test' };
    delete env.DASHBOARD_ORIGIN;
    const run = (file, args = [], overrides = {}) => spawnSync(process.execPath, [file, ...args], {
        env: { ...env, ...overrides }, encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    assert.equal(run('dist/admin.js').status, 1);
    assert.equal(run('dist/admin.js', ['?', 'extra']).status, 1);
    const created = run('dist/admin.js', ['carol']);
    assert.equal(created.status, 0); // Never include stdout (a generated password) in diagnostic output.
    assert.ok(created.stdout.startsWith('Created carol.'));
    assert.equal(run('dist/admin.js', ['carol']).status, 1);
    assert.equal(run('dist/app.js', [], { NODE_ENV: 'production' }).status, 1);
    assert.equal(run('dist/app.js', [], { NODE_ENV: 'production', DASHBOARD_ORIGIN: 'http://example.com' }).status, 1);
    const store = new DashboardStore(database);
    try { assert.ok(store.credentials('carol')); }
    finally { store.close(); }
    app = createApp({ database, port: 0 });
    await once(app.server, 'listening');
    const unavailable = run('dist/app.js', [], { PORT: String(app.server.address().port) });
    assert.equal(unavailable.status, 1);
    assert.match(unavailable.stderr, /Application listener failed/);
    child = spawn(process.execPath, ['dist/app.js'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    const deadline = Date.now() + 5000;
    while (!output.includes('/login') && Date.now() < deadline && child.exitCode === null) await delay(20);
    assert.match(output, /Dashboard: http:\/\/127\.0\.0\.1:\d+\/login/);
    const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit;
});
