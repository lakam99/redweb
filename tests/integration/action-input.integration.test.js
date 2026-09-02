const { z } = require('zod');
const WebSocket = require('ws');
const { RedwebClient } = require('redweb-client');
const { action, page, start } = require('../..');
const { createActionPage } = require('../fixtures/action-page');
const { waitForListening, request, silentLogger, waitForCondition, withTimeout } = require('../helpers/network');
const { closeClient } = require('../../scripts/realtime-harness');
const { settleTasks } = require('../../src/serverLifecycle');
const fs = require('fs');
const path = require('path');
const { verifyActionInput } = require('../../scripts/lib/verify-action-input');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');

jest.setTimeout(90000); // Existing acquisition/request deadlines plus native cleanup; no inner limit changes.

describe('action input validation over real HTTP and WebSockets', () => {
    test('compiled standard and legacy decorators preserve typed validation in source-free consumers', async () => {
        const execution = new VerificationWorkspace();
        await execution.run(owner => verifyActionInput(path.resolve(__dirname, '../..'), owner));
        expect(fs.existsSync(execution.directory)).toBe(false);
    }, 360000); // Two compiles plus bounded acquisition, twelve requests and cleanup per ABI.

    const servers = [];
    const clients = [];
    const sockets = [];
    afterEach(async () => {
        const failures = await settleTasks(clients.splice(0).map(client => () => client.dispose()));
        failures.push(...await settleTasks(sockets.splice(0).map(socket => () => closeClient(socket))));
        failures.push(...await settleTasks(servers.splice(0).map(server => () => withTimeout(server.shutdown(), 'action test shutdown', 10000))));
        if (failures.length) throw new AggregateError(failures, 'Action test cleanup failed', { cause: failures[0] });
    }, 30000); // Native socket closure and server shutdown each retain their own bounds.
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
            version: config.version, requestTimeoutMs: 2000, reconnect: { enabled: false },
            webSocketFactory: url => {
                const socket = new WebSocket(url, { handshakeTimeout: 5000, headers: { Origin: origin } });
                sockets.push(socket); return socket;
            },
        });
        clients.push(client);
        await withTimeout(client.connect(), 'action test connection', 5000);
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

    test('checks current permissions after asynchronous validation and keeps denials recoverable', async () => {
        let allowed = true, finish, calls = 0, policyInput;
        class Page { render() { return '<p>Permission check</p>'; } run(value, context) { calls += 1; return { value, principal: context.principal }; } }
        page('/')(Page);
        action({ input: z.string().transform(async value => {
            if (value === '3') await new Promise(resolve => { finish = resolve; });
            return Number(value);
        }), authorize: (context, input) => {
            policyInput = input;
            return context.principal === 'owner' && allowed;
        } })(Page.prototype, 'run', Object.getOwnPropertyDescriptor(Page.prototype, 'run'));
        const client = await connect(Page, { authenticate: () => 'owner' });
        const pending = client.request('redweb:html', { kind: 'action', name: 'run', args: ['3'] });
        const denied = expect(pending).rejects.toMatchObject({ code: 'ACCESS_DENIED', message: 'This operation is not permitted.' });
        await waitForCondition(() => finish, 'validation entered');
        allowed = false;
        finish();
        await denied;
        expect(policyInput).toBe(3);
        expect(calls).toBe(0);
        expect(client.state).toBe('open');
        allowed = true;
        expect((await client.request('redweb:html', { kind: 'action', name: 'run', args: ['4'] })).payload).toEqual({ value: 4, principal: 'owner' });
        expect(calls).toBe(1);
    });

    test('times out policies, signals cancellation, and ignores late permission', async () => {
        let finish, policySignal, calls = 0;
        class Page { render() { return '<p>Permission timeout</p>'; } run(value) { calls += 1; return value; } }
        page('/')(Page);
        action({ authorizationTimeoutMs: 20, authorize: (context, input) => {
            if (input !== 'slow') return true;
            policySignal = context.signal;
            return new Promise(resolve => { finish = resolve; });
        } })(Page.prototype, 'run', Object.getOwnPropertyDescriptor(Page.prototype, 'run'));
        const client = await connect(Page);
        await expect(client.request('redweb:html', { kind: 'action', name: 'run', args: ['slow'] })).rejects.toMatchObject({ code: 'ACCESS_TIMEOUT' });
        // A busy host may expire the deadline before entering application policy.
        // The separate synchronized-entry disconnect case proves unconditional abort.
        if (policySignal) expect(policySignal.aborted).toBe(true);
        finish?.(true);
        expect((await client.request('redweb:html', { kind: 'action', name: 'run', args: ['fast'] })).payload).toBe('fast');
        expect(calls).toBe(1);
    });

    test('disconnect aborts a pending policy without invoking its action after late approval', async () => {
        let finish, policySignal, calls = 0;
        class Page { render() { return '<p>Permission cancellation</p>'; } run() { calls += 1; } }
        page('/')(Page);
        action({ authorize: context => {
            policySignal = context.signal;
            return new Promise(resolve => { finish = resolve; });
        } })(Page.prototype, 'run', Object.getOwnPropertyDescriptor(Page.prototype, 'run'));
        const client = await connect(Page);
        const pending = client.request('redweb:html', { kind: 'action', name: 'run', args: [] }).catch(() => null);
        await waitForCondition(() => finish, 'policy entered');
        client.close();
        await pending;
        await waitForCondition(() => policySignal.aborted, 'policy cancellation');
        finish(true);
        await new Promise(resolve => setTimeout(resolve, 25));
        expect(calls).toBe(0);
    });

    test('policy exceptions stay sanitized application failures, not permission denials', async () => {
        let calls = 0;
        class Page { render() { return '<p>Broken policy</p>'; } run() { calls += 1; } }
        page('/')(Page);
        action({ authorize: () => { throw new Error('private permission database password'); } })(Page.prototype, 'run', Object.getOwnPropertyDescriptor(Page.prototype, 'run'));
        const client = await connect(Page);
        await expect(client.request('redweb:html', { kind: 'action', name: 'run', args: [] })).rejects.toMatchObject({ code: 'HANDLER_FAILED', message: 'Handler failed' });
        expect(calls).toBe(0);
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
