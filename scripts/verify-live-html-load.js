'use strict';

const { start } = require('..');
const { createChatroomPage } = require('../examples/live-html/chatroom');
const { silentLogger: logger, waitFor: waitForEvent } = require('./realtime-harness');
const { readLiveHtmlPage: getPage } = require('./lib/readLiveHtmlPage');
const { LiveHtmlLoadClient } = require('./lib/LiveHtmlLoadClient');
const { settleTasks } = require('../src/serverLifecycle');
const { verificationError } = require('./lib/verificationError');
const { withTimeout } = require('../tests/helpers/network');

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitFor(predicate, label, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}.`);
        await pause(10);
    }
}

async function complete(tasks) {
    const failures = (await settleTasks(tasks)).map(verificationError);
    if (failures.length) throw new AggregateError(failures, failures[0].message, { cause: failures[0] });
}

async function main() {
    if (typeof global.gc !== 'function') throw new Error('Run the Live HTML load gate with --expose-gc.');
    const server = start(createChatroomPage(), {
        port: 0,
        bind: '127.0.0.1',
        logger,
        maxSessions: 500,
        sessionTtlMs: 1000,
    });
    const clients = [];
    const failures = [];
    let result;
    const checkClients = () => clients.forEach(client => client.check());
    const until = (predicate, label) => waitFor(() => { checkClients(); return predicate(); }, label);
    try {
        if (!server.server.listening) await waitForEvent(server.server, 'listening');
        const port = server.server.address().port;
        global.gc();
        const baseline = process.memoryUsage().heapUsed;

        await complete(Array.from({ length: 200 }, () => () => getPage(port)));
        if (server.manager.pending.size !== 200) throw new Error('Pending-session concurrency accounting failed.');
        await waitFor(() => server.manager.pending.size === 0, 'pending-session expiry');

        const liveClients = 110;
        const configs = [];
        await complete(Array.from({ length: liveClients }, (_, index) => async () => { configs[index] = await getPage(port); }));
        const updates = configs.map(() => []);
        configs.forEach((config, index) => clients.push(new LiveHtmlLoadClient(port, config, updates[index])));
        await complete(clients.map(client => () => client.connect()));
        await until(() => updates.every(messages => messages.length >= 1), 'initial state fan-out');
        await complete(clients.map((client, index) => () => client.client.request('redweb:html', {
            kind: 'action',
            component: 'chat',
            name: 'join',
            args: [{ name: `load-${index}` }],
        })));
        await until(
            () => updates.every(messages => messages.at(-1)?.html.includes(`Online · ${liveClients}`)),
            `${liveClients}-client room presence`
        );
        if (!updates[0].at(-1)?.html.includes('+10 more')) throw new Error('Visible presence list was not capped.');
        clients[0].client.send('redweb:html', {
            kind: 'action',
            component: 'chat',
            name: 'send',
            args: [{ message: 'ordered-broadcast' }],
        });
        await until(
            () => updates.every(messages => messages.at(-1)?.html.includes('ordered-broadcast')),
            `${liveClients}-client broadcast delivery`
        );

        await complete(clients.map(client => () => client.close()));
        checkClients();
        clients.length = 0;
        await waitFor(() => server.manager.active.size === 0, 'disconnected-session expiry');
        global.gc();
        await pause(50);
        global.gc();
        const growth = process.memoryUsage().heapUsed - baseline;
        const limit = 24 * 1024 * 1024;
        if (growth > limit) throw new Error(`Live HTML heap grew by ${growth} bytes; limit is ${limit}.`);
        result = `Live HTML load gate passed: 200 expired renders, ${liveClients} live clients, heap delta ${growth} bytes.`;
    } catch (error) { failures.push(verificationError(error)); }
    failures.push(...(await settleTasks(clients.map(client => () => client.close()))).map(verificationError));
    for (const client of clients) {
        if (client.failure && !failures.includes(client.failure)) failures.push(client.failure);
    }
    try { await withTimeout(server.shutdown(), 'Live HTML load server shutdown', 10000); }
    catch (error) { failures.push(verificationError(error)); }
    if (failures.length) throw new AggregateError(failures, failures[0].message, { cause: failures[0] });
    console.log(result);
}

main().catch(error => {
    console.error(require('./diagnostics/recovery-split.cjs').describeFailure(error));
    process.exitCode = 1;
});
