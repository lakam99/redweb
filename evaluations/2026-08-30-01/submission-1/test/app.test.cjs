const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createInterface } = require('node:readline');
const path = require('node:path');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve(__dirname, '../.browsers');
const { chromium } = require('playwright');

test('two real browsers share chat, counter and presence over WebSockets', { timeout: 45000 }, async () => {
    const child = spawn(process.execPath, ['dist/app.js'], {
        cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let browser;
    let stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    try {
        const url = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Startup timed out: ${stderr}`)), 10000);
            const lines = createInterface({ input: child.stdout });
            lines.on('line', line => {
                try {
                    const value = JSON.parse(line);
                    if (value.url) { clearTimeout(timer); lines.close(); resolve(value.url); }
                } catch {}
            });
            child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${stderr}`)); });
        });
        assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
        const response = await fetch(url);
        assert.equal(response.status, 200);
        assert.match(await response.text(), /Team room/);

        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const alice = await context.newPage();
        const bob = await context.newPage();
        const frames = { sent: 0, received: 0, sockets: 0 };
        const errors = [];
        for (const visitor of [alice, bob]) {
            visitor.on('pageerror', error => errors.push(error.message));
            visitor.on('websocket', socket => {
                frames.sockets++;
                socket.on('framesent', () => frames.sent++);
                socket.on('framereceived', () => frames.received++);
            });
            await visitor.goto(url);
            await visitor.waitForFunction(() => document.documentElement.dataset.rwConnection === 'open');
        }
        const text = (page, id, expected) => page.waitForFunction(({ id, expected }) =>
            document.querySelector(`[data-testid="${id}"]`)?.textContent === expected, { id, expected });
        const contains = (page, id, expected) => page.waitForFunction(({ id, expected }) =>
            document.querySelector(`[data-testid="${id}"]`)?.textContent.includes(expected), { id, expected });
        await text(alice, 'count', '0');
        await text(bob, 'count', '0');
        await alice.getByTestId('name').fill('Alice');
        await alice.getByTestId('join').click();
        await contains(alice, 'members', 'Alice');
        await alice.getByTestId('message').fill('Unsent Alice draft');
        await bob.getByTestId('name').fill('Bob');
        await bob.getByTestId('join').click();
        for (const visitor of [alice, bob]) {
            await contains(visitor, 'members', 'Alice');
            await contains(visitor, 'members', 'Bob');
        }
        const literal = '<img src=x onerror="globalThis.pwned=true"> & hello <script>globalThis.pwned=true</script>';
        await bob.getByTestId('message').fill(literal);
        await bob.getByTestId('send').click();
        for (const visitor of [alice, bob]) {
            await contains(visitor, 'messages', literal);
            await contains(visitor, 'messages', 'Bob');
            assert.equal(await visitor.getByTestId('messages').locator('img,script').count(), 0);
            assert.equal(await visitor.evaluate(() => globalThis.pwned), undefined);
        }
        await bob.getByTestId('increment').click();
        for (const visitor of [alice, bob]) await text(visitor, 'count', '1');
        await alice.getByTestId('increment').click();
        for (const visitor of [alice, bob]) await text(visitor, 'count', '2');
        assert.equal(await alice.getByTestId('message').inputValue(), 'Unsent Alice draft');
        await alice.getByTestId('send').click();
        for (const visitor of [alice, bob]) await contains(visitor, 'messages', 'Unsent Alice draft');

        const fresh = await context.newPage();
        await fresh.goto(url);
        await text(fresh, 'count', '2');
        await contains(fresh, 'messages', literal);
        await contains(fresh, 'messages', 'Unsent Alice draft');

        const closeStarted = Date.now();
        await bob.close();
        await alice.waitForFunction(() => !document.querySelector('[data-testid="members"]').textContent.includes('Bob'), null, { timeout: 5000 });
        assert.ok(Date.now() - closeStarted < 5000, 'presence disappears within five seconds');
        await contains(alice, 'members', 'Alice');
        assert.ok(frames.sockets >= 2, 'actual browser WebSockets opened');
        assert.ok(frames.sent >= 5 && frames.received >= 5, 'actual WebSockets carried actions and updates');
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ websocketTraffic: frames, disconnectMs: Date.now() - closeStarted }));
    } finally {
        if (browser) await browser.close();
        if (child.exitCode === null) {
            const exited = once(child, 'exit');
            child.kill();
            await exited;
        }
    }
});
