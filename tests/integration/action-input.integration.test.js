const { z } = require('zod');
const WebSocket = require('ws');
const { RedwebClient } = require('redweb-client');
const { action, page, start } = require('../..');
const { createActionPage } = require('../fixtures/action-page');
const { waitForListening, request, silentLogger, waitForCondition } = require('../helpers/network');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { verifyActionInput } = require('../../scripts/lib/verify-action-input');

describe('action input validation over real HTTP and WebSockets', () => {
    test('compiled standard and legacy decorators preserve typed validation in source-free consumers', async () => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-action-consumer-'));
        try { await verifyActionInput(path.resolve(__dirname, '../..'), workspace); }
        finally { fs.rmSync(workspace, { recursive: true, force: true }); }
    }, 30000);

    const servers = [];
    const clients = [];
    afterEach(async () => {
        clients.splice(0).forEach(client => client.close());
        await Promise.all(servers.splice(0).map(server => server.shutdown()));
    });
    async function connect(Page, options = {}) {
        const server = start(Page, { port: 0, bind: '127.0.0.1', logger: silentLogger, ...options });
        servers.push(server);
        await waitForListening(server.server);
        const port = server.server.address().port;
        const response = await request({ port });
        expect(response.status).toBe(200);
        const config = JSON.parse(response.body.match(/id="__redweb_page">([^<]+)/)[1]);
        const origin = `http://127.0.0.1:${port}`;
        const client = new RedwebClient(`${origin.replace('http:', 'ws:')}${config.socketPath}?pageId=${config.pageId}`, {
            version: config.version, requestTimeoutMs: 2000,
            webSocketFactory: url => new WebSocket(url, { headers: { Origin: origin } }),
        });
        clients.push(client);
        await client.connect();
        return client;
    }

    test('rejects invalid form input without disconnecting and scopes validated component actions', async () => {
        const client = await connect(createActionPage(), { authenticate: () => 'trusted-owner' });
        const invoke = (component, args) => client.request('redweb:html', { kind: 'action', name: 'save', component, args });
        await expect(invoke('first', [{ amount: 'private-invalid-input' }])).rejects.toMatchObject({ code: 'ACTION_INVALID_INPUT' });
        for (const amount of ['9'.repeat(400), '9007199254740993', '1001', '0']) {
            await expect(invoke('first', [{ amount }])).rejects.toMatchObject({ code: 'ACTION_INVALID_INPUT' });
        }
        expect(client.state).toBe('open');
        await expect(invoke('first', [{ amount: '3' }, { principal: 'forged-owner' }])).rejects.toMatchObject({ code: 'ACTION_INVALID_INPUT' });
        expect((await invoke('first', [{ amount: '3' }])).payload).toEqual({ total: 3, principal: 'trusted-owner' });
        expect((await invoke('second', [{ amount: '2' }])).payload).toEqual({ total: 2, principal: 'trusted-owner' });
        expect((await invoke('first', [{ amount: '1' }])).payload.total).toBe(4);
    });

    test('times out validation without running the action and allows subsequent requests', async () => {
        let calls = 0;
        class Page { render() { return '<p>Validation deadline</p>'; } run(value) { calls += 1; return value; } }
        page('/')(Page);
        action({ input: z.string().transform(async value => {
            if (value === 'slow') await new Promise(resolve => setTimeout(resolve, 60));
            return value;
        }), validationTimeoutMs: 15 })(Page.prototype, 'run', Object.getOwnPropertyDescriptor(Page.prototype, 'run'));
        const client = await connect(Page);
        await expect(client.request('redweb:html', { kind: 'action', name: 'run', args: ['slow'] })).rejects.toMatchObject({ code: 'ACTION_VALIDATION_TIMEOUT' });
        expect((await client.request('redweb:html', { kind: 'action', name: 'run', args: ['fast'] })).payload).toBe('fast');
        await new Promise(resolve => setTimeout(resolve, 80));
        expect(calls).toBe(1);
    });

    test('disconnect cancellation prevents late validation from invoking application code', async () => {
        let entered = false, finish, calls = 0;
        class Page { render() { return '<p>Cancellation</p>'; } run() { calls += 1; } }
        page('/')(Page);
        action({ input: z.string().transform(async value => {
            entered = true;
            await new Promise(resolve => { finish = resolve; });
            return value;
        }) })(Page.prototype, 'run', Object.getOwnPropertyDescriptor(Page.prototype, 'run'));
        const client = await connect(Page);
        const pending = client.request('redweb:html', { kind: 'action', name: 'run', args: ['input'] }).catch(() => null);
        await waitForCondition(() => entered, 'validation started');
        client.close();
        await pending;
        await waitForCondition(() => client.state === 'closed', 'client close');
        await new Promise(resolve => setTimeout(resolve, 25));
        finish();
        await new Promise(resolve => setTimeout(resolve, 25));
        expect(calls).toBe(0);
    });

    test('validator bugs remain sanitized server errors instead of recoverable input failures', async () => {
        class Page { render() { return '<p>Server bug</p>'; } run() { throw new Error('must not run'); } }
        page('/')(Page);
        action({ input: z.string().transform(() => { throw new Error('database password'); }) })(Page.prototype, 'run', Object.getOwnPropertyDescriptor(Page.prototype, 'run'));
        const client = await connect(Page);
        await expect(client.request('redweb:html', { kind: 'action', name: 'run', args: ['input'] })).rejects.toMatchObject({ code: 'HANDLER_FAILED', message: 'Handler failed' });
    });

    test.each([null, false, 'private validator bug'])('malformed validator issues (%p) remain server errors', async issues => {
        let calls = 0;
        class Page { render() { return '<p>Malformed validator</p>'; } run() { calls += 1; } }
        page('/')(Page);
        action({ input: { '~standard': { version: 1, validate: () => ({ issues }) } } })(Page.prototype, 'run', Object.getOwnPropertyDescriptor(Page.prototype, 'run'));
        const client = await connect(Page);
        await expect(client.request('redweb:html', { kind: 'action', name: 'run', args: ['input'] })).rejects.toMatchObject({ code: 'HANDLER_FAILED', message: 'Handler failed' });
        expect(calls).toBe(0);
    });
});
