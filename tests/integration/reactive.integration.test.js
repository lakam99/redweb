const WebSocket = require('ws');
const { RedwebClient } = require('redweb-client');
const { start, page } = require('../..');
const { ReactivePage, SharedReactivePage } = require('../fixtures/reactive-pages');
const { request, waitForListening, waitForCondition, silentLogger } = require('../helpers/network');

const id = name => `c${Buffer.from(name).toString('hex')}`;
const delay = () => new Promise(resolve => setTimeout(resolve, 30));

describe('automatic reactive rendering over real HTTP/WebSockets', () => {
    let server;
    const clients = [];
    afterEach(async () => {
        for (const { client } of clients.splice(0)) client.close();
        await server?.shutdown();
    });

    async function boot(Type = ReactivePage, options = {}) {
        server = start(Type, { port: 0, bind: '127.0.0.1', logger: silentLogger, ...options });
        await waitForListening(server.server);
    }

    async function visitor(name, config) {
        const port = server.server.address().port;
        const response = config ? null : await request({ port, path: `/?visitor=${name}` });
        if (!config) config = JSON.parse(response.body.match(/id="__redweb_page">([^<]+)/)[1]);
        const updates = [];
        const legacy = [];
        const origin = `http://127.0.0.1:${port}`;
        const client = new RedwebClient(`${origin.replace('http:', 'ws:')}${config.socketPath}?pageId=${config.pageId}`, {
            version: config.version, webSocketFactory: url => new WebSocket(url, { headers: { Origin: origin } }),
        });
        client.on('redweb:patch', message => updates.push(message.payload));
        client.on('redweb:state', message => legacy.push(message.payload));
        const value = { client, updates, legacy, config, response };
        clients.push(value);
        await client.connect();
        await waitForCondition(() => updates.length > 0, 'reactive snapshot');
        return value;
    }

    async function invoke(visitor, name, component) {
        await visitor.client.request('redweb:html', { kind: 'action', name, component, args: [] });
    }

    test('batches component changes, preserves nested ownership, and suppresses unused state', async () => {
        await boot();
        const person = await visitor('Alice');
        expect(person.response.body).toContain('id="visitor">Alice');
        person.updates.length = 0;
        await invoke(person, 'increment', 'primary');
        await waitForCondition(() => person.updates.length > 0, 'component patch');
        expect(person.updates).toHaveLength(1);
        expect(person.updates[0].patches.map(patch => patch.id)).toEqual([id('primary')]);
        expect(person.updates[0].patches[0].html).toContain('class="derived">4');
        expect(person.updates[0].states).toEqual([{ name: 'count', value: '2', html: false, component: 'primary' }]);
        expect(person.legacy).toEqual([]);
        person.updates.length = 0;
        await invoke(person, 'nothing');
        await delay();
        expect(person.updates).toEqual([]);
        await invoke(person, 'increment', 'nested.leaf');
        await waitForCondition(() => person.updates.length > 0, 'nested patch');
        expect(person.updates[0].patches.map(patch => patch.id)).toEqual([id('nested.leaf')]);
        person.updates.length = 0;
        await invoke(person, 'reverse');
        await waitForCondition(() => person.updates.length > 0, 'parent patch');
        expect(person.updates[0].patches[0].id).toBe('root');
        expect(person.updates[0].patches[0].html).toContain('class="derived">4');
    });

    test('keeps shared-page request context per visitor and per-session reconnect snapshots', async () => {
        await boot(SharedReactivePage);
        const [alice, bob] = await Promise.all([visitor('Alice'), visitor('Bob')]);
        alice.updates.length = bob.updates.length = 0;
        await invoke(alice, 'reverse');
        await waitForCondition(() => alice.updates.length && bob.updates.length, 'shared patches');
        expect(alice.updates[0].patches[0].html).toContain('id="visitor">Alice');
        expect(bob.updates[0].patches[0].html).toContain('id="visitor">Bob');
        alice.client.close();
        const session = server.manager.active.get(alice.config.pageId);
        await waitForCondition(() => session.socket === null && !session.detaching, 'disconnect');
        await invoke(bob, 'increment', 'primary');
        const reconnected = await visitor('ignored', alice.config);
        expect(reconnected.updates[0].patches[0].html).toContain('class="derived">4');
        expect(reconnected.updates[0].patches[0].html).toContain('id="visitor">Alice');
    });

    test('connection pages stay isolated and conditional components rejoin the render tree', async () => {
        await boot();
        const alice = await visitor('Alice');
        const bob = await visitor('Bob');
        alice.updates.length = bob.updates.length = 0;
        await invoke(alice, 'toggle');
        await waitForCondition(() => alice.updates.length > 0, 'hide');
        expect(alice.updates[0].patches[0].html).toContain('id="hidden"');
        alice.updates.length = 0;
        await invoke(alice, 'increment', 'primary');
        await delay();
        expect(alice.updates).toEqual([]);
        await invoke(alice, 'toggle');
        await waitForCondition(() => alice.updates.length > 0, 'show');
        expect(alice.updates[0].patches[0].html).toContain('class="derived">4');
        expect(bob.updates).toEqual([]);
    });

    test('unchanged markup sends no patch and render failures close only the affected connection', async () => {
        const errors = [];
        await boot(ReactivePage, { logger: { error(message) { errors.push(message); throw new Error('Logger unavailable'); } } });
        const person = await visitor('Alice');
        const session = server.manager.active.get(person.config.pageId);
        person.updates.length = 0;
        session.page.items = [...session.page.items];
        await delay();
        expect(person.updates).toEqual([]);
        // An oversized render must be contained rather than escape its scheduled task.
        session.page.items = ['x'.repeat(1024 * 1024 + 1)];
        await waitForCondition(() => session.socket === null, 'render failure closes connection');
        expect(person.updates).toEqual([]);
        expect(errors).toContain('Live HTML reactive render failed.');
    });

    test('disconnect cancels an unresolved render so reconnect is not blocked by it', async () => {
        let blocked = false;
        let entered = false;
        let resolveOld;
        class AsyncPage extends SharedReactivePage {
            async render(context) {
                if (blocked) {
                    entered = true;
                    await new Promise(resolve => { resolveOld = resolve; });
                }
                return super.render(context);
            }
        }
        page('/', { shared: true })(AsyncPage);
        await boot(AsyncPage);
        const person = await visitor('Alice');
        const session = server.manager.active.get(person.config.pageId);
        blocked = true;
        await invoke(person, 'reverse');
        await waitForCondition(() => entered, 'pending render');
        person.client.close();
        await waitForCondition(() => !session.socket && !session.detaching, 'detached pending render');
        blocked = false;
        const again = await visitor('Alice', person.config);
        expect(again.updates).toHaveLength(1);
        resolveOld();
        await delay();
        expect(again.updates).toHaveLength(1);
    });
});
