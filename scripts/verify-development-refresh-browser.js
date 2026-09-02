'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const net = require('net');
const path = require('path');
const ProjectInitializer = require('../src/cli/ProjectInitializer');
const { VerificationWorkspace } = require('./lib/VerificationWorkspace');
const { verificationError } = require('./lib/verificationError');
const { browserCommands } = require('./lib/browserCommands');
const { BrowserPages } = require('./lib/BrowserPages');
const { npmEntrypoint, spawnManaged, stopProcessTree } = require('./evaluation/process');
const { browserCandidates, launchBrowserWithRetry, stopBrowser, openPage, combineFailures } = require('./verify-live-html-browser');
const { verifyRefreshControls } = require('./lib/verify-refresh-controls');
const { withTimeout } = require('../tests/helpers/network');
const bounded = (promise, label) => withTimeout(promise, label, 15000);

async function until(check, label, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try { if (await check()) return; } catch { /* Navigation/build transitions are expected. */ }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out: ${label}`);
}

async function click(page, expression) {
    const point = await page.evaluate(`(() => { const box = (${expression}).getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()`);
    await page.command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await page.command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
}

async function closePage(page, debugPort) {
    let failure;
    try {
        const id = new URL(page.socket.url).pathname.split('/').at(-1);
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/close/${id}`, { signal: AbortSignal.timeout(5000) });
        assert.ok(response.ok, 'DevTools page close must succeed');
        await response.text();
    } catch (error) { failure = verificationError(error); }
    try { page.socket.terminate(); }
    catch (error) { failure = combineFailures(failure, verificationError(error)); }
    if (failure) throw failure;
}

async function availablePort(execution) {
    const reservation = net.createServer();
    let port, failure;
    try {
        await bounded(new Promise((resolve, reject) => {
            reservation.once('error', reject);
            reservation.listen(0, '127.0.0.1', resolve);
        }), 'development port reservation');
        port = reservation.address().port;
    } catch (error) { failure = verificationError(error); }
    try {
        await bounded(new Promise((resolve, reject) => reservation.close(error => {
            if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
            else resolve();
        })), 'development port release');
    } catch (error) {
        let cleanup = verificationError(error);
        try { reservation.unref(); }
        catch (release) { cleanup = combineFailures(cleanup, verificationError(release)); }
        execution.cleanupFailure = combineFailures(execution.cleanupFailure, cleanup);
        failure = combineFailures(failure, cleanup);
    }
    if (failure) throw failure;
    return port;
}

async function verifyTemplate(execution, debugPort, template, open) {
    const project = path.join(execution.directory, template);
    const root = path.resolve(__dirname, '..');
    new ProjectInitializer(require('../package.json').version).initialize(project, { template });
    fs.mkdirSync(path.join(project, 'node_modules'));
    for (const [name, location] of [
        ['redweb', root], ['typescript', path.dirname(require.resolve('typescript/package.json'))],
        ['nodemon', path.dirname(require.resolve('nodemon/package.json'))], ['.bin', path.join(root, 'node_modules/.bin')],
    ]) fs.symlinkSync(location, path.join(project, 'node_modules', name), 'junction');
    const sourceFile = path.join(project, 'src/app.tsx');
    let source = fs.readFileSync(sourceFile, 'utf8');
    const title = template === 'site' ? 'Your server-rendered app is ready.' : 'A counter owned by the server';
    source = source.replace(title, 'Generation one');
    if (template === 'realtime') source = source.replace('</main>', `<form><label>Draft<input id="draft" /></label>
        <label>Choice<select id="choice"><option>First</option><option>Second</option></select></label>
        <button type="reset" id="reset">Reset draft</button></form></main>`);
    fs.writeFileSync(sourceFile, source);
    const port = await availablePort(execution);
    const url = `http://127.0.0.1:${port}`;
    const watcher = spawnManaged([npmEntrypoint(), 'run', 'dev'], { cwd: project,
        env: { ...process.env, PORT: String(port), NODE_ENV: 'development' } });
    const closed = new Promise(resolve => watcher.once('close', resolve));
    let output = '', failure;
    const recordCleanup = value => {
        const error = verificationError(value);
        execution.cleanupFailure = combineFailures(execution.cleanupFailure, error);
        failure = combineFailures(failure, error);
    };
    watcher.stdout.on('data', chunk => { output = (output + chunk).slice(-65536); });
    watcher.stderr.on('data', chunk => { output = (output + chunk).slice(-65536); });
    const pages = [];
    try {
        await new Promise((resolve, reject) => {
            watcher.once('spawn', resolve);
            watcher.once('error', reject);
        });
        await until(async () => (await (await fetch(url, { signal: AbortSignal.timeout(2000) })).text()).includes('Generation one'), `${template} initial server`);
        const initial = await open(debugPort, url);
        pages.push(initial);
        const browser = browserCommands(initial);
        await until(() => browser.evaluate('Boolean(document.getElementById("__redweb_dev")?.shadowRoot)'), 'development script startup');
        await browser.evaluate('window.__documentMarker = "original"; window.__developmentHost = document.getElementById("__redweb_dev"); true');
        let revisionResponses = 0;
        browser.socket.on('message', raw => {
            const message = JSON.parse(String(raw));
            if (message.method === 'Network.responseReceived' && message.params.response.url === `${url}/__redweb/development`) revisionResponses++;
        });
        await browser.command('Network.enable');
        await until(() => revisionResponses >= 2, 'same-revision polls');
        assert.equal(await browser.evaluate('window.__documentMarker'), 'original');
        source = source.replace('Generation one', 'Generation two');
        fs.writeFileSync(sourceFile, source);
        await until(() => browser.evaluate('document.querySelector("h1").textContent === "Generation two"'), 'clean automatic refresh (including default select)');
        assert.equal(await browser.evaluate('window.__documentMarker === undefined'), true);
        if (template === 'realtime') {
            const rawPeer = await open(debugPort, url);
            pages.push(rawPeer);
            const peer = browserCommands(rawPeer);
            await click(browser, 'document.getElementById("draft")');
            await browser.command('Input.insertText', { text: 'Keep my unsent draft' });
            await browser.evaluate('window.__documentMarker = "edited"; window.__developmentHost = document.getElementById("__redweb_dev"); true');
            await click(peer, 'document.querySelector("button[rw-click]")');
            await until(() => browser.evaluate('document.querySelector("button[rw-click]")?.textContent.trim() === "Count 1"'), 'peer-triggered root patch');
            assert.equal(await browser.evaluate('document.activeElement.id === "draft" && document.getElementById("draft").value === "Keep my unsent draft" && window.__developmentHost === document.getElementById("__redweb_dev") && Boolean(window.__developmentHost.shadowRoot)'), true);
            fs.writeFileSync(sourceFile, `${source}\nconst invalid: number = 'broken build';\n`);
            await until(() => output.includes('TS2322') && output.includes('app crashed'), 'failed build remains stopped');
            assert.equal(await browser.evaluate('window.__documentMarker === "edited" && !document.getElementById("__redweb_dev").shadowRoot.querySelector("button")'), true);
            source = source.replace('Generation two', 'Generation three');
            fs.writeFileSync(sourceFile, source);
            await until(() => browser.evaluate('Boolean(document.getElementById("__redweb_dev").shadowRoot.querySelector("button"))'), 'edited document confirmation');
            assert.equal(await browser.evaluate('document.querySelector("h1").textContent === "Generation two" && document.activeElement.id === "draft" && document.getElementById("draft").value === "Keep my unsent draft"'), true);
            await until(() => peer.evaluate('document.querySelector("h1")?.textContent === "Generation three" && document.querySelector("button[rw-click]")?.textContent.trim() === "Count 0"'), 'clean peer reload and server-state reset');
            await until(() => browser.evaluate('getComputedStyle(document.getElementById("__redweb_dev")).position === "fixed"'), 'external notice stylesheet');
            await click(browser, 'document.getElementById("reset")');
            assert.equal(await browser.evaluate('window.__documentMarker === "edited" && Boolean(document.getElementById("__redweb_dev").shadowRoot.querySelector("button"))'), true);
            await browser.command('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
            await browser.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
            assert.equal(await browser.evaluate('document.getElementById("__redweb_dev").shadowRoot.activeElement?.matches("button:focus-visible")'), true);
            await browser.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 });
            await browser.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
            await until(() => browser.evaluate('document.querySelector("h1").textContent === "Generation three" && document.getElementById("draft").value === ""'), 'explicit discard reload');
            assert.equal(await browser.evaluate('localStorage.length === 0 && sessionStorage.length === 0'), true);
        }
        fs.appendFileSync(path.join(project, 'src/app.css'), '\n.home { border-left: 7px solid rgb(90, 20, 180); }\n');
        await until(() => browser.evaluate('getComputedStyle(document.querySelector(".home")).borderLeftWidth === "7px"'), 'CSS rebuild refresh');
        assert.ok(!output.includes('EADDRINUSE'), output);
        console.log(`${template} refresh passed: real generated watcher, clean TSX/CSS reload, ${template === 'realtime' ? 'root patch, failed build, draft/focus retention, explicit discard and state reset' : 'static served page without live socket runtime'}.`);
    } catch (error) {
        const primary = verificationError(error);
        failure = new Error(`${primary.message}\n${output}`, { cause: primary });
    }
    finally {
        for (const page of pages) {
            try { await closePage(page, debugPort); }
            catch (error) { failure = combineFailures(failure, verificationError(error)); }
        }
        try {
            await stopProcessTree(watcher);
            await withTimeout(closed, 'development watcher closure', 5000);
        }
        catch (error) {
            recordCleanup(error);
            for (const release of [() => watcher.stdout.destroy(), () => watcher.stderr.destroy(), () => watcher.unref()]) {
                try { release(); } catch (error) { recordCleanup(error); }
            }
        }
    }
    if (failure) throw failure;
}

async function main() {
    await new VerificationWorkspace().run(async execution => {
        const executable = browserCandidates.find(file => fs.existsSync(file));
        if (!executable) throw new Error('Chromium is required for the development refresh browser gate.');
        const profile = path.join(execution.directory, 'browser');
        fs.mkdirSync(profile);
        const pages = new BrowserPages(execution, openPage, bounded);
        const open = (port, url) => pages.open(port, url);
        let browser, failure;
        const recordCleanup = value => {
            const error = verificationError(value);
            execution.cleanupFailure = combineFailures(execution.cleanupFailure, error);
            failure = combineFailures(failure, error);
        };
        try {
            const launched = await launchBrowserWithRetry(executable, profile);
            browser = launched.browser;
            const endpoint = launched.endpoint;
            const debugPort = new URL(endpoint).port;
            for (const template of ['realtime', 'site']) await verifyTemplate(execution, debugPort, template, open);
            await verifyRefreshControls(debugPort, execution.directory, { until, click, closePage, open });
        } catch (error) { failure = verificationError(error); }
        finally {
            try { await pages.close(); } catch (error) { recordCleanup(error); }
            try {
                if (browser) {
                    await withTimeout(stopBrowser(browser.child), 'development refresh browser shutdown', 15000);
                    if (browser.child.exitCode === null && browser.child.signalCode === null) {
                        throw new Error('Development refresh browser did not exit; retaining its workspace.');
                    }
                } else throw new Error('Development refresh browser launch cleanup could not be independently verified.');
            } catch (error) {
                recordCleanup(error);
                for (const release of [() => browser?.child.stderr?.destroy(), () => browser?.child.unref()]) {
                    try { release(); } catch (error) { recordCleanup(error); }
                }
            }
        }
        if (failure) throw failure;
    });
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main, verifyTemplate, availablePort, closePage };
