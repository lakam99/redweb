'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { action, attribute, codeBlock, component, each, html, page, start, state, url } = require('..');
const HtmlRenderer = require('../src/htmx/HtmlRenderer');
const { CounterPage } = require('../examples/live-html/counter');
const { createChatroomPage } = require('../examples/live-html/chatroom');
const { CardsPage } = require('../examples/live-html/cards');
const { ComponentsPage } = require('../examples/live-html/components');
const { JsxPage } = require('../examples/live-html/jsx-page');
const { jsx, jsxs } = require('../jsx-runtime');
const { ReactivePage } = require('../tests/fixtures/reactive-pages');
const { createActionPage } = require('../tests/fixtures/action-page');
const { verifyActionFeedback } = require('./lib/verify-action-feedback');

class TableComponent {
    count = 0;
    increment() { this.count += 1; }
    render() {
        return jsxs('tr', { children: [
            jsx('td', { children: jsx('output', { 'data-rw-state': 'count', children: this.count }) }),
            jsx('td', { children: jsx('button', { 'rw-click': 'increment', children: 'Add' }) }),
        ] });
    }
}
component()(TableComponent);
state()(TableComponent.prototype, 'count');
action()(TableComponent.prototype, 'increment', Object.getOwnPropertyDescriptor(TableComponent.prototype, 'increment'));
class OptionComponent {
    label = 'Scoped option';
    render() { return jsx('option', { 'data-rw-state': 'label', children: this.label }); }
}
component()(OptionComponent);
state()(OptionComponent.prototype, 'label');
class ComponentBoundaryPage {
    row = new TableComponent();
    option = new OptionComponent();
    render() {
        return html`<!doctype html><html><head>
            <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; connect-src 'self' ws:; style-src 'none'">
        </head><body><table><tbody>${this.row}</tbody></table><select>${this.option}</select></body></html>`;
    }
}
page('/')(ComponentBoundaryPage);

const logger = Object.freeze({ log() {}, warn() {}, error() {} });
const browserCandidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ]
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

function waitForListening(server) {
    if (server.listening) return Promise.resolve();
    return new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
}

function jsonRequest(url, method = 'GET') {
    return new Promise((resolve, reject) => {
        const request = http.request(url, { method }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
                try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
                catch (error) { reject(error); }
            });
        });
        request.once('error', reject);
        request.end();
    });
}

function launchBrowser(executable, profile) {
    const child = spawn(executable, [
        '--headless=new',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    const endpoint = new Promise((resolve, reject) => {
        let stderr = '';
        const timer = setTimeout(() => reject(new Error(`Browser did not expose DevTools. ${stderr}`)), 20_000);
        child.stderr.on('data', chunk => {
            stderr += chunk.toString();
            const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
            if (!match) return;
            clearTimeout(timer);
            resolve(match[1]);
        });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Browser exited early (${code}). ${stderr}`)); });
    });
    return { child, endpoint };
}

async function stopBrowser(child) {
    const exited = () => child.exitCode !== null || child.signalCode !== null;
    if (!child || exited()) return;
    const waitForExit = milliseconds => new Promise(resolve => {
        if (exited()) return resolve();
        const done = () => { clearTimeout(timer); child.off('exit', done); resolve(); };
        const timer = setTimeout(done, milliseconds);
        child.once('exit', done);
    });
    child.kill();
    await waitForExit(2_000);
    if (!exited()) {
        child.kill('SIGKILL');
        await waitForExit(2_000);
    }
}

async function launchBrowserWithRetry(executable, profileRoot) {
    const errors = [];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        const profile = path.join(profileRoot, `attempt-${attempt}`);
        fs.mkdirSync(profile);
        const browser = launchBrowser(executable, profile);
        try {
            return { browser, endpoint: await browser.endpoint };
        } catch (error) {
            errors.push(error);
            await stopBrowser(browser.child);
        }
    }
    throw new AggregateError(errors, 'Browser did not expose DevTools after two bounded attempts.');
}

async function openPage(debugPort, url) {
    const target = await jsonRequest(`http://127.0.0.1:${debugPort}/json/new?about:blank`, 'PUT');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
    });
    let sequence = 0;
    const pending = new Map();
    const events = new Map();
    socket.on('message', data => {
        const message = JSON.parse(data.toString());
        if (!message.id) {
            const listeners = events.get(message.method) || [];
            events.delete(message.method);
            listeners.forEach(resolve => resolve(message.params));
            return;
        }
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
    });
    const nextEvent = method => new Promise(resolve => {
        const listeners = events.get(method) || [];
        listeners.push(resolve);
        events.set(method, listeners);
    });
    await command('Page.enable');
    await command('Runtime.enable');
    const loaded = nextEvent('Page.loadEventFired');
    await command('Page.navigate', { url });
    await loaded;
    const evaluate = async expression => {
        const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
        return result.result.value;
    };
    if (url.startsWith('http')) await evaluate(eventual(`!document.getElementById('__redweb_page') || document.documentElement.getAttribute('data-rw-connection') === 'open'`, 'live page connection readiness'));
    return { socket, evaluate, command };
}

function eventual(expression, label) {
    return `(async () => {
        const deadline = Date.now() + 7000;
        while (!(${expression})) {
            if (Date.now() >= deadline) throw new Error(${JSON.stringify(`Timed out waiting for ${label}`)});
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        return true;
    })()`;
}

async function removeTemporaryDirectory(directory) {
    const deadline = Date.now() + 5_000;
    while (true) {
        try {
            fs.rmSync(directory, { recursive: true, force: true });
            return;
        } catch (error) {
            if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error.code) || Date.now() >= deadline) throw error;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
}

function combineFailures(primary, cleanup) {
    if (!primary) return cleanup;
    return new AggregateError([primary, cleanup], primary.message, { cause: primary });
}

async function main() {
    const executable = process.env.REDWEB_BROWSER || browserCandidates.find(fs.existsSync);
    if (!executable) throw new Error('Chrome, Edge, or Chromium is required for the Live HTML browser gate.');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-live-browser-'));
    const counter = start(CounterPage, { port: 0, bind: '127.0.0.1', logger });
    const chat = start(createChatroomPage(), { port: 0, bind: '127.0.0.1', logger });
    const cards = start(CardsPage, { port: 0, bind: '127.0.0.1', logger });
    const components = start(ComponentsPage, { port: 0, bind: '127.0.0.1', logger });
    const jsxServer = start(JsxPage, { port: 0, bind: '127.0.0.1', logger });
    const reactiveServer = start(ReactivePage, { port: 0, bind: '127.0.0.1', logger });
    const componentBoundaries = start(ComponentBoundaryPage, { port: 0, bind: '127.0.0.1', logger });
    const validatedActions = start(createActionPage(), { port: 0, bind: '127.0.0.1', logger });
    const pages = [];
    let browser;
    let failure;
    try {
        await Promise.all([
            waitForListening(counter.server),
            waitForListening(chat.server),
            waitForListening(cards.server),
            waitForListening(components.server),
            waitForListening(jsxServer.server),
            waitForListening(reactiveServer.server),
            waitForListening(componentBoundaries.server),
            waitForListening(validatedActions.server),
        ]);
        const launched = await launchBrowserWithRetry(executable, profile);
        browser = launched.browser;
        const endpoint = new URL(launched.endpoint);
        const debugPort = Number(endpoint.port);

        await verifyActionFeedback({ openPage, debugPort, pages, eventual });

        const actionPage = await openPage(debugPort, `http://127.0.0.1:${validatedActions.server.address().port}/`);
        pages.push(actionPage);
        await actionPage.evaluate(eventual(`Boolean(document.querySelector('form[data-rw-component="first"]'))`, 'validated form readiness'));
        await actionPage.evaluate(`(() => {
            window.actionErrors = [];
            document.addEventListener('redweb:error', event => actionErrors.push({ code: event.detail.code, message: event.detail.message }));
            const form = document.querySelector('form[data-rw-component="first"]');
            form.elements.amount.value = 'private-invalid';
            form.requestSubmit();
        })()`);
        await actionPage.evaluate(eventual(`actionErrors.length === 1`, 'invalid form response'));
        if (!await actionPage.evaluate(`actionErrors[0].code === 'ACTION_INVALID_INPUT' && !actionErrors[0].message.includes('private-invalid') && document.querySelector('form[data-rw-component="first"]').elements.amount.value === 'private-invalid'`)) throw new Error('Invalid form input was reset or disclosed by validation.');
        await actionPage.evaluate(`(() => {
            const form = document.querySelector('form[data-rw-component="first"]');
            form.elements.amount.value = '3';
            const extra = document.createElement('input');
            extra.name = '__proto__'; extra.value = 'must reach validation'; form.append(extra);
            form.requestSubmit();
        })()`);
        await actionPage.evaluate(eventual(`actionErrors.length === 2`, 'prototype-named field validation'));
        await actionPage.evaluate(`(() => {
            const form = document.querySelector('form[data-rw-component="first"]');
            form.querySelector('[name="__proto__"]').remove();
            form.requestSubmit();
        })()`);
        await actionPage.evaluate(eventual(`document.querySelector('form[data-rw-component="first"] output').textContent === '3'`, 'corrected validated form'));
        if (!await actionPage.evaluate(`document.querySelector('form[data-rw-component="second"] output').textContent === '0'`)) throw new Error('Validated action escaped its component scope.');

        const counterPage = await openPage(debugPort, `http://127.0.0.1:${counter.server.address().port}/`);
        pages.push(counterPage);
        await counterPage.evaluate(eventual(
            `Number(document.querySelector('[data-rw-state="count"]')?.textContent) >= 2`,
            'the real browser counter DOM update'
        ));
        const counterColor = await counterPage.evaluate("getComputedStyle(document.querySelector('output')).color");
        if (counterColor !== 'rgb(103, 232, 249)') throw new Error(`Counter CSS was not applied: ${counterColor}`);

        const chatUrl = `http://127.0.0.1:${chat.server.address().port}/`;
        const first = await openPage(debugPort, chatUrl);
        const second = await openPage(debugPort, chatUrl);
        pages.push(first, second);
        await Promise.all([first, second].map(page => page.evaluate(eventual(
            `document.querySelector('form[rw-submit="join"][data-rw-component="chat"]') && document.querySelector('.chatroom')`,
            'chat join readiness'
        ))));
        await first.evaluate(`(() => {
            document.querySelector('[name="name"]').value = '<Admin>';
            document.querySelector('form[rw-submit="join"]').requestSubmit();
            return true;
        })()`);
        await first.evaluate(eventual(`document.querySelector('form[rw-submit="send"]')`, 'first participant join'));
        await first.evaluate(`(() => {
            const input = document.querySelector('[name="message"]');
            input.value = 'draft survives presence';
            input.focus();
            return true;
        })()`);
        await second.evaluate(`(() => {
            document.querySelector('[name="name"]').value = 'Ada';
            document.querySelector('form[rw-submit="join"]').requestSubmit();
            return true;
        })()`);
        await Promise.all([first, second].map(page => page.evaluate(eventual(
            `document.querySelector('.presence')?.textContent.includes('Online · 2')`,
            'chat presence update'
        ))));
        const preservedDraft = await first.evaluate(`(() => {
            const input = document.querySelector('[name="message"]');
            return input.value === 'draft survives presence' && document.activeElement === input;
        })()`);
        if (!preservedDraft) throw new Error('A presence update replaced the active chat composer.');
        await first.evaluate(`(() => {
            document.querySelector('[name="message"]').value = '<script>window.__redwebInjected = true<\\/script>';
            document.querySelector('form[rw-submit="send"]').requestSubmit();
            return true;
        })()`);
        const received = `document.querySelector('.message-list')?.textContent.includes('<script>window.__redwebInjected = true</script>')`;
        await Promise.all([first, second].map(page => page.evaluate(eventual(received, 'the real browser chat broadcast'))));
        const safety = await Promise.all([first, second].map(page => page.evaluate('window.__redwebInjected !== true')));
        if (!safety.every(Boolean)) throw new Error('Escaped chat content executed in the browser.');
        const chatButtonColor = await first.evaluate("getComputedStyle(document.querySelector('.composer button')).backgroundColor");
        if (chatButtonColor !== 'rgb(34, 211, 238)') throw new Error(`Chatroom CSS was not applied: ${chatButtonColor}`);

        const cardsPage = await openPage(debugPort, `http://127.0.0.1:${cards.server.address().port}/`);
        pages.push(cardsPage);
        await cardsPage.evaluate(eventual(`document.querySelectorAll('.card').length === 2`, 'initial server-rendered cards'));
        await cardsPage.evaluate("document.querySelector('[rw-click=\"add\"]').click()");
        await cardsPage.evaluate(eventual(`document.querySelectorAll('.card').length === 3`, 'realtime card collection update'));
        const cardBackground = await cardsPage.evaluate("getComputedStyle(document.querySelector('.card')).backgroundColor");
        if (cardBackground !== 'rgb(31, 41, 55)') throw new Error(`Card CSS was not applied: ${cardBackground}`);

        const componentsPage = await openPage(debugPort, `http://127.0.0.1:${components.server.address().port}/`);
        pages.push(componentsPage);
        await componentsPage.evaluate(eventual(
            `document.querySelectorAll('button[data-rw-component]').length === 2`,
            'component DOM readiness'
        ));
        await componentsPage.evaluate(`document.querySelector('button[data-rw-component="primary"]').click()`);
        await componentsPage.evaluate(eventual(
            `document.querySelector('output[data-rw-component="primary"]').textContent === '1'`,
            'the primary component server action'
        ));
        const componentIsolation = await componentsPage.evaluate(
            `document.querySelector('output[data-rw-component="secondary"]').textContent === '0'`
        );
        if (!componentIsolation) throw new Error('A component action updated a sibling component instance.');

        const jsxPage = await openPage(debugPort, `http://127.0.0.1:${jsxServer.server.address().port}/jsx`);
        pages.push(jsxPage);
        await jsxPage.evaluate(`document.querySelector('[rw-click="increment"]').click()`);
        await jsxPage.evaluate(eventual(
            `document.querySelector('output').textContent === '1'`,
            'the TSX server action DOM update'
        ));
        const jsxCardColor = await jsxPage.evaluate("getComputedStyle(document.querySelector('.counter-card')).backgroundColor");
        if (jsxCardColor !== 'rgb(17, 24, 39)') throw new Error(`TSX page CSS was not applied: ${jsxCardColor}`);

        const reactivePage = await openPage(debugPort, `http://127.0.0.1:${reactiveServer.server.address().port}/?visitor=Browser`);
        pages.push(reactivePage);
        await reactivePage.evaluate(`document.querySelector('#primary button').click()`);
        await reactivePage.evaluate(eventual(`document.querySelector('#primary .derived').textContent === '4'`, 'derived component expression'));
        await reactivePage.evaluate(`
            window.savedInput = document.querySelector('input[name="b"]');
            window.savedSecondary = document.querySelector('#secondary');
            savedInput.value = 'unsubmitted draft';
            savedInput.focus();
            savedInput.setSelectionRange(3, 8);
            document.querySelector('#reverse').click();
        `);
        await reactivePage.evaluate(eventual(`document.querySelector('li[data-item]').getAttribute('data-item') === 'c'`, 'keyed fragment reorder'));
        const preserved = await reactivePage.evaluate(`
            savedInput === document.querySelector('input[name="b"]') &&
            savedInput.value === 'unsubmitted draft' && document.activeElement === savedInput &&
            savedInput.selectionStart === 3 && savedInput.selectionEnd === 8 &&
            savedSecondary === document.querySelector('#secondary') &&
            document.querySelector('#primary .derived').textContent === '4'
        `);
        if (!preserved) throw new Error('Reactive keyed rendering lost node identity, draft input, selection, focus, or component state.');
        await reactivePage.evaluate(`document.querySelector('#toggle').click()`);
        await reactivePage.evaluate(eventual(`Boolean(document.querySelector('#hidden'))`, 'conditional removal'));
        if (!await reactivePage.evaluate(`savedSecondary === document.querySelector('#secondary')`)) throw new Error('Removing a sibling replaced an unrelated identified element.');
        await reactivePage.evaluate(`document.querySelector('#toggle').click()`);
        await reactivePage.evaluate(eventual(`document.querySelector('#primary .derived')?.textContent === '4'`, 'conditional component restoration'));
        await reactivePage.evaluate(`document.querySelector('[data-rw-component="nested.leaf"][rw-click]').click()`);
        await reactivePage.evaluate(eventual(`document.querySelector('aside .derived').textContent === '4'`, 'nested component patch'));
        await reactivePage.evaluate(`
            document.querySelector('#server-input').value = 'draft';
            document.querySelector('#server-textarea').value = 'draft text';
            document.querySelector('#server-checkbox').checked = true;
            document.querySelector('#server-select').value = 'b';
            document.querySelector('#reverse').click();
        `);
        await reactivePage.evaluate(eventual(`document.querySelector('li[data-item]').getAttribute('data-item') === 'a'`, 'second reorder'));
        if (!await reactivePage.evaluate(`
            document.querySelector('#server-input').value === 'draft' &&
            document.querySelector('#server-textarea').value === 'draft text' &&
            document.querySelector('#server-checkbox').checked && document.querySelector('#server-select').value === 'b'
        `)) throw new Error('Unchanged server values erased local form input.');
        await reactivePage.evaluate(`
            document.querySelector('#server-select').value = 'a';
            const input = document.querySelector('#server-input');
            input.focus(); input.setSelectionRange(0, 2);
            document.querySelector('#update-controls').click();
        `);
        await reactivePage.evaluate(eventual(`document.querySelector('#server-input').value === '42'`, 'changed server form values'));
        if (!await reactivePage.evaluate(`
            document.querySelector('#server-textarea').value === 'server text' &&
            document.querySelector('#server-checkbox').checked && document.querySelector('#server-select').value === 'b'
        `)) throw new Error('Changed server form values were not applied.');

        const boundaryPage = await openPage(debugPort, `http://127.0.0.1:${componentBoundaries.server.address().port}/`);
        pages.push(boundaryPage);
        const validBoundaries = await boundaryPage.evaluate(`
            document.querySelector('tr').parentElement.tagName === 'TBODY' &&
            document.querySelector('option').parentElement.tagName === 'SELECT' &&
            !document.querySelector('rw-component') &&
            !document.querySelector('[data-rw-component][style]')
        `);
        if (!validBoundaries) throw new Error('Component boundaries changed restricted HTML structure or required inline styles.');
        await boundaryPage.evaluate(`document.querySelector('button[data-rw-component="row"]').click()`);
        await boundaryPage.evaluate(eventual(
            `document.querySelector('output[data-rw-component="row"]').textContent === '1'`,
            'the table component action under strict CSP'
        ));
        [...componentBoundaries.manager.active.values()][0].page.option.label = 'Updated option';
        await boundaryPage.evaluate(eventual(`document.querySelector('select option').textContent === 'Updated option'`, 'reactive option boundary'));

        const noscriptMarkup = HtmlRenderer.render(
            '<body><noscript><span id="hidden">{{ value }}</span></noscript><p id="after">{{ value }}</p></body>',
            { value: 'ready' }
        );
        const noscriptDocument = HtmlRenderer.document(noscriptMarkup, {
            pageId: 'browser-probe', socketPath: '/live', runtimePath: '/runtime.js', version: '1',
        });
        const noscriptPage = await openPage(debugPort, `data:text/html;charset=utf-8,${encodeURIComponent(noscriptDocument)}`);
        pages.push(noscriptPage);
        const noscriptSafety = await noscriptPage.evaluate(`(() => {
            const after = document.querySelector('#after');
            const bootstrap = document.querySelector('#__redweb_page');
            return document.querySelector('#hidden') === null &&
                after?.textContent === 'ready' &&
                Boolean(after.compareDocumentPosition(bootstrap) & Node.DOCUMENT_POSITION_FOLLOWING);
        })()`);
        if (!noscriptSafety) throw new Error('Scripting-enabled noscript parsing diverged from server rendering.');

        const plaintextMarkup = HtmlRenderer.render(
            '<plaintext>raw</plaintext><p id="plaintext-after">{{ value }}</p>',
            { value: 'must remain inert' }
        );
        const plaintextDocument = HtmlRenderer.document(plaintextMarkup, {
            pageId: 'plaintext-probe', socketPath: '/live', runtimePath: '/runtime.js', version: '1',
        });
        const plaintextPage = await openPage(debugPort, `data:text/html;charset=utf-8,${encodeURIComponent(plaintextDocument)}`);
        pages.push(plaintextPage);
        const plaintextSafety = await plaintextPage.evaluate(`
            document.querySelector('#plaintext-after') === null &&
            document.querySelector('#__redweb_page') === null &&
            document.body.textContent.includes('{{ value }}')
        `);
        if (!plaintextSafety) throw new Error('Plaintext content became active browser DOM.');
        let jsxPlaintextRejected = false;
        try { jsx('plaintext', { children: 'terminal' }); }
        catch (error) { jsxPlaintextRejected = error instanceof TypeError; }
        if (!jsxPlaintextRejected) throw new Error('JSX allowed a terminal plaintext element.');

        const sections = [{ id: 'http', name: 'HTTP' }, { id: 'sockets', name: 'Sockets' }];
        const composedMarkup = html`<main>${each(sections, section => html`
            <article id="${attribute(section.id)}">
                <a href="${url(`#${section.id}`)}">${section.name}</a>
                ${codeBlock(`const section = '${section.name}'`, { language: 'js' })}
            </article>
        `)}</main>`;
        const composedPage = await openPage(debugPort, `data:text/html;charset=utf-8,${encodeURIComponent(HtmlRenderer.document(composedMarkup.toString()))}`);
        pages.push(composedPage);
        const compositionReady = await composedPage.evaluate(`
            document.querySelectorAll('article').length === 2 &&
            document.querySelector('#sockets a').getAttribute('href') === '#sockets' &&
            document.querySelector('#http code').textContent.includes("section = 'HTTP'")
        `);
        if (!compositionReady) throw new Error('Documentation composition helpers produced incorrect browser DOM.');
        const payload = '<script>window.__redwebJsxInjected = true</script>';
        const jsxMarkup = jsxs('main', { children: [
            jsx('h1', { children: payload }),
            jsx('video', { id: 'video-off', disablePictureInPicture: false, disableRemotePlayback: false }),
            jsx('video', { id: 'video-on', disablePictureInPicture: true, disableRemotePlayback: true }),
            jsx('div', { id: 'flags', 'aria-hidden': false, 'data-ready': false, writingsuggestions: false }),
            jsx('div', { id: 'translate-off', translate: false }),
            jsx('div', { id: 'translate-on', translate: true }),
            html`<p>mixed fragment</p>`,
        ] });
        const jsxSafetyPage = await openPage(debugPort, `data:text/html;charset=utf-8,${encodeURIComponent(HtmlRenderer.document(jsxMarkup.toString()))}`);
        pages.push(jsxSafetyPage);
        const jsxSafety = await jsxSafetyPage.evaluate(`
            window.__redwebJsxInjected !== true &&
            document.querySelector('h1').textContent === ${JSON.stringify(payload)} &&
            !document.querySelector('#video-off').hasAttribute('disablepictureinpicture') &&
            !document.querySelector('#video-off').hasAttribute('disableremoteplayback') &&
            document.querySelector('#video-on').hasAttribute('disablepictureinpicture') &&
            document.querySelector('#video-on').hasAttribute('disableremoteplayback') &&
            document.querySelector('#flags').getAttribute('aria-hidden') === 'false' &&
            document.querySelector('#flags').getAttribute('data-ready') === 'false' &&
            document.querySelector('#flags').getAttribute('writingsuggestions') === 'false' &&
            document.querySelector('#translate-off').translate === false &&
            document.querySelector('#translate-on').translate === true &&
            document.querySelector('p').textContent === 'mixed fragment'
        `);
        if (!jsxSafety) throw new Error('Escaped JSX content executed or composed incorrectly in the browser.');
        console.log('Live HTML browser gate passed: validated actions and feedback, CSS, JSX, collections, components, counter, chat, raw-text safety, and documentation composition.');
    } catch (error) {
        failure = error;
    } finally {
        pages.forEach(page => page.socket.close());
        await stopBrowser(browser?.child);
        await Promise.allSettled([
            counter.shutdown(), chat.shutdown(), cards.shutdown(), components.shutdown(), jsxServer.shutdown(), reactiveServer.shutdown(), componentBoundaries.shutdown(), validatedActions.shutdown(),
        ]);
        try {
            await removeTemporaryDirectory(profile);
        } catch (error) {
            failure = combineFailures(failure, error);
        }
    }
    if (failure) throw failure;
}

if (require.main === module) {
    main().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = { combineFailures, stopBrowser };
