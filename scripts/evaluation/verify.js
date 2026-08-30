'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { browserCandidates, launchBrowserWithRetry, openPage, eventual, stopBrowser, removeTemporaryDirectory, combineFailures } = require('../verify-live-html-browser');
const { withTimeout } = require('../../tests/helpers/network');
const { runBuild, spawnManaged, stopProcessTree, listenerAddresses } = require('./process');
const CHECKS = ['loopback-binding', 'http-and-two-tabs', 'shared-server-counter', 'named-presence', 'message-delivery',
    'draft-preservation', 'literal-message-safety', 'disconnect-presence', 'fresh-page-snapshot', 'actual-websocket-traffic'];

async function startApplication(root, environment, entry = 'dist/app.js') {
    const child = spawnManaged([path.join(root, entry)], {
        cwd: root, env: { ...process.env, ...environment, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let output = '', errors = '';
    const ready = new Promise((resolve, reject) => {
        child.stdout.on('data', chunk => {
            output = (output + chunk).slice(-1024 * 1024);
            for (const line of output.split(/\r?\n/)) {
                let value;
                try { value = JSON.parse(line); } catch { continue; }
                if (typeof value?.url !== 'string') continue;
                try {
                    const url = new URL(value.url);
                    assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1');
                    assert.ok(Number(url.port) > 0); assert.equal(url.pathname, '/');
                    assert.equal(url.username + url.password + url.search + url.hash, '');
                    resolve(url.origin);
                } catch { reject(new Error('Application must report an ephemeral loopback HTTP URL.')); }
            }
        });
        child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-1024 * 1024); });
        child.once('error', reject);
        child.once('exit', code => reject(new Error(`Application exited before readiness (${code}): ${errors}`)));
    });
    try { return { child, url: await withTimeout(ready, 'application startup', 15000), output: () => ({ output, errors }) }; }
    catch (error) { await stopProcessTree(child); throw error; }
}

const selector = name => `[data-testid="${name}"]`;
const element = name => `document.querySelector(${JSON.stringify(selector(name))})`;
const contents = name => `${element(name)}?.textContent`;
const click = async (page, name) => {
    const point = await page.evaluate(`(() => { const button = ${element(name)}; button.scrollIntoView();
        const rect = button.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`);
    await page.command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await page.command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
};
const type = async (page, name, value) => {
    await page.evaluate(`${element(name)}.focus(); ${element(name)}.select()`);
    await page.command('Input.insertText', { text: value });
};
const observe = (page, expression, label) => withTimeout(page.evaluate(eventual(expression, label)), label, 10000);

async function recordCheck(checks, name, work) {
    const started = Date.now();
    try { await work(); checks.push({ name, passed: true, durationMs: Date.now() - started }); }
    catch (error) { checks.push({ name, passed: false, durationMs: Date.now() - started, error: error.message }); throw error; }
}

async function inspectRoom(url, checks, browserReport = {}) {
    const executable = process.env.REDWEB_BROWSER || browserCandidates.find(fs.existsSync);
    if (!executable) throw new Error('A real Chromium browser is required for independent acceptance.');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'framework-acceptance-browser-'));
    const browsers = [];
    const pages = [];
    const network = [];
    const networkErrors = [];
    const browserVersions = [];
    browserReport.browserVersions = browserVersions;
    browserReport.networkEventCounts = {};
    let result, failure;
    const check = (name, work) => recordCheck(checks, name, work);
    try {
        const visit = async () => {
            const visitorProfile = path.join(profile, `visitor-${browsers.length + 1}`);
            fs.mkdirSync(visitorProfile);
            const launched = await launchBrowserWithRetry(executable, visitorProfile);
            browsers.push(launched.browser.child);
            const port = Number(new URL(launched.endpoint).port);
            const page = await withTimeout(openPage(port, 'about:blank'), 'browser tab', 10000);
            pages.push(page);
            const command = page.command, evaluate = page.evaluate;
            page.command = (method, params) => withTimeout(command(method, params), method, 10000);
            page.evaluate = expression => withTimeout(evaluate(expression), 'browser evaluation', 10000);
            browserVersions.push(await page.command('Browser.getVersion'));
            let connected = false;
            let blockData = false;
            const pendingData = new Set();
            page.socket.on('message', data => {
                const event = JSON.parse(String(data));
                if (event.method === 'Fetch.requestPaused') {
                    page.command(blockData ? 'Fetch.failRequest' : 'Fetch.continueRequest', {
                        requestId: event.params.requestId, ...(blockData ? { errorReason: 'BlockedByClient' } : {}),
                    })
                        .catch(error => networkErrors.push(error.message));
                }
                if (event.method === 'Network.requestWillBeSent' && ['XHR', 'Fetch', 'EventSource'].includes(event.params.type)) pendingData.add(event.params.requestId);
                if (['Network.loadingFinished', 'Network.loadingFailed'].includes(event.method)) pendingData.delete(event.params.requestId);
                if (event.method?.startsWith('Network.webSocket')) {
                    browserReport.networkEventCounts[event.method] = (browserReport.networkEventCounts[event.method] || 0) + 1;
                    if (network.length < 10000) network.push({ method: event.method, requestId: event.params.requestId });
                    if (event.method === 'Network.webSocketHandshakeResponseReceived' && event.params.response.status === 101) connected = true;
                }
            });
            await page.command('Network.enable');
            await page.command('Fetch.enable', { patterns: ['XHR', 'Fetch', 'EventSource'].map(resourceType => ({
                urlPattern: 'http*', resourceType, requestStage: 'Request',
            })) });
            await page.command('Page.navigate', { url });
            await observe(page, `document.readyState === 'complete' && ${element('increment')} && ${element('name')}`, 'room controls');
            const deadline = Date.now() + 5000;
            while (!connected) {
                if (Date.now() >= deadline) throw new Error('Room did not establish a real WebSocket connection.');
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            // Subsequent room actions must not quietly rely on HTTP polling/fetch.
            blockData = true;
            const dataDeadline = Date.now() + 5000;
            while (pendingData.size) {
                if (Date.now() >= dataDeadline) throw new Error('Persistent HTTP data stream prevents independent WebSocket-only verification.');
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            return page;
        };
        let alice, bob;
        await check('http-and-two-tabs', async () => {
            const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
            assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/html/);
            alice = await visit(); bob = await visit();
            await observe(alice, `${contents('count')}?.trim() === '0'`, 'Alice initial counter');
            await observe(bob, `${contents('count')}?.trim() === '0'`, 'Bob initial counter');
        });
        await check('shared-server-counter', async () => {
            await click(alice, 'increment');
            for (const page of [alice, bob]) await observe(page, `${contents('count')}?.trim() === '1'`, 'first shared increment');
            await click(bob, 'increment');
            for (const page of [alice, bob]) await observe(page, `${contents('count')}?.trim() === '2'`, 'second shared increment');
        });
        await check('named-presence', async () => {
            await type(alice, 'name', 'Alice'); await click(alice, 'join');
            await type(bob, 'name', 'Bob'); await click(bob, 'join');
            for (const page of [alice, bob]) await observe(page, `${contents('members')}?.includes('Alice') && ${contents('members')}?.includes('Bob')`, 'both members');
        });
        await check('message-delivery', async () => {
            await type(alice, 'message', 'Hello from the independent trial'); await click(alice, 'send');
            for (const page of [alice, bob]) await observe(page, `${contents('messages')}?.includes('Hello from the independent trial') && ${contents('messages')}?.includes('Alice')`, 'named message delivery');
        });
        await check('draft-preservation', async () => {
            await type(bob, 'message', 'unsent draft'); await click(alice, 'increment');
            await observe(bob, `${contents('count')}?.trim() === '3'`, 'counter during draft');
            assert.equal(await bob.evaluate(`${element('message')}.value`), 'unsent draft');
        });
        await check('literal-message-safety', async () => {
            const text = '<img src=x onerror="window.trialInjected=true">';
            await type(alice, 'message', text); await click(alice, 'send');
            for (const page of [alice, bob]) {
                await observe(page, `${contents('messages')}?.includes(${JSON.stringify(text)})`, 'literal unsafe-looking message');
                assert.equal(await page.evaluate(`Boolean(window.trialInjected) || Boolean(${element('messages')}.querySelector('img,script'))`), false);
            }
        });
        await check('disconnect-presence', async () => {
            await bob.command('Page.close'); bob.socket.close();
            const started = Date.now();
            while (await alice.evaluate(`${contents('members')}?.includes('Bob')`)) {
                if (Date.now() - started >= 5000) throw new Error('Disconnected Bob remained in presence longer than five seconds.');
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            assert.ok(await alice.evaluate(`${contents('members')}?.includes('Alice')`));
        });
        await check('fresh-page-snapshot', async () => {
            const fresh = await visit();
            await observe(fresh, `${contents('count')}?.trim() === '3' && ${contents('messages')}?.includes('Hello from the independent trial')`, 'fresh server snapshot');
        });
        await check('actual-websocket-traffic', async () => {
            assert.deepEqual(networkErrors, [], 'HTTP data-transport interception failed.');
            for (const method of ['Network.webSocketCreated', 'Network.webSocketFrameSent', 'Network.webSocketFrameReceived']) {
                assert.ok(network.some(event => event.method === method), `Missing real browser event ${method}`);
            }
        });
        result = browserReport;
    } catch (error) {
        failure = error;
    } finally {
        for (const page of pages) page.socket.close();
        for (const browser of browsers) {
            try { await stopBrowser(browser); }
            catch (error) { failure = combineFailures(failure, error); }
        }
        try { await removeTemporaryDirectory(profile); }
        catch (error) { failure = combineFailures(failure, error); }
    }
    if (failure) throw failure;
    return result;
}

async function verify(root, options = {}) {
    root = path.resolve(root);
    const report = { startedAt: new Date().toISOString(), root, checks: [], passed: false };
    let app;
    try {
        if (!options.skipBuild) {
            report.build = await runBuild(root);
            if (report.build.exitCode !== 0 || report.build.error) throw new Error('Independent production build failed.');
        }
        app = await startApplication(root, options.environment, options.entry);
        report.origin = app.url;
        await recordCheck(report.checks, 'loopback-binding', async () => {
            report.listenerAddresses = listenerAddresses(Number(new URL(app.url).port));
            assert.ok(report.listenerAddresses.length > 0 && report.listenerAddresses.every(address => ['127.0.0.1', '::1'].includes(address)), 'Application listens on a non-loopback interface.');
        });
        report.browser = {};
        await inspectRoom(app.url, report.checks, report.browser);
        report.passed = true;
    } catch (error) {
        report.error = error.message;
        if (error instanceof AggregateError) report.causes = error.errors.map(cause => cause.message);
    }
    finally {
        if (app) report.application = app.output();
        try { await stopProcessTree(app?.child); }
        catch (error) { report.cleanupError = error.message; report.passed = false; }
        report.endedAt = new Date().toISOString();
        report.durationMs = Date.parse(report.endedAt) - Date.parse(report.startedAt);
        report.notRun = CHECKS.filter(name => !report.checks.some(check => check.name === name));
    }
    return report;
}

if (require.main === module) verify(process.argv[2]).then(report => {
    if (process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
});
module.exports = { verify, inspectRoom, startApplication };
