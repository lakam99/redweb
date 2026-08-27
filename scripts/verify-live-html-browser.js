'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { start } = require('..');
const { CounterPage } = require('../examples/live-html/counter');
const { ChatroomPage } = require('../examples/live-html/chatroom');
const { CardsPage } = require('../examples/live-html/cards');

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
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    const endpoint = new Promise((resolve, reject) => {
        let stderr = '';
        const timer = setTimeout(() => reject(new Error(`Browser did not expose DevTools. ${stderr}`)), 10_000);
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
    return { socket, evaluate };
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

async function main() {
    const executable = process.env.REDWEB_BROWSER || browserCandidates.find(fs.existsSync);
    if (!executable) throw new Error('Chrome, Edge, or Chromium is required for the Live HTML browser gate.');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-live-browser-'));
    const counter = start(CounterPage, { port: 0, bind: '127.0.0.1', logger });
    const chat = start(ChatroomPage, { port: 0, bind: '127.0.0.1', logger });
    const cards = start(CardsPage, { port: 0, bind: '127.0.0.1', logger });
    const pages = [];
    let browser;
    try {
        await Promise.all([waitForListening(counter.server), waitForListening(chat.server), waitForListening(cards.server)]);
        browser = launchBrowser(executable, profile);
        const endpoint = new URL(await browser.endpoint);
        const debugPort = Number(endpoint.port);

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
            `document.querySelector('form[rw-submit]') && document.querySelector('[data-rw-state="messages"]')`,
            'chat DOM readiness'
        ))));
        await first.evaluate(`(() => {
            document.querySelector('[name="name"]').value = '<Admin>';
            document.querySelector('[name="message"]').value = '<script>window.__redwebInjected = true<\\/script>';
            document.querySelector('form[rw-submit]').requestSubmit();
            return true;
        })()`);
        const received = `document.querySelector('[data-rw-state="messages"]')?.textContent.includes('<script>window.__redwebInjected = true</script>')`;
        await Promise.all([first, second].map(page => page.evaluate(eventual(received, 'the real browser chat broadcast'))));
        const safety = await Promise.all([first, second].map(page => page.evaluate('window.__redwebInjected !== true')));
        if (!safety.every(Boolean)) throw new Error('Escaped chat content executed in the browser.');
        const chatButtonColor = await first.evaluate("getComputedStyle(document.querySelector('button')).backgroundColor");
        if (chatButtonColor !== 'rgb(34, 211, 238)') throw new Error(`Chatroom CSS was not applied: ${chatButtonColor}`);

        const cardsPage = await openPage(debugPort, `http://127.0.0.1:${cards.server.address().port}/`);
        pages.push(cardsPage);
        await cardsPage.evaluate(eventual(`document.querySelectorAll('.card').length === 2`, 'initial server-rendered cards'));
        await cardsPage.evaluate("document.querySelector('[rw-click=\"add\"]').click()");
        await cardsPage.evaluate(eventual(`document.querySelectorAll('.card').length === 3`, 'realtime card collection update'));
        const cardBackground = await cardsPage.evaluate("getComputedStyle(document.querySelector('.card')).backgroundColor");
        if (cardBackground !== 'rgb(31, 41, 55)') throw new Error(`Card CSS was not applied: ${cardBackground}`);
        console.log('Live HTML browser gate passed: CSS, collections, counter updates, and two-client chat interaction.');
    } finally {
        pages.forEach(page => page.socket.close());
        if (browser?.child.exitCode === null) {
            const exited = new Promise(resolve => browser.child.once('exit', resolve));
            browser.child.kill();
            await exited;
        }
        await Promise.allSettled([counter.shutdown(), chat.shutdown(), cards.shutdown()]);
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
