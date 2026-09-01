'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { browserCandidates, launchBrowserWithRetry, stopBrowser, openPage, eventual } = require('../verify-live-html-browser');
const { withTimeout, waitForListening } = require('../../tests/helpers/network');
const { verificationError } = require('./verificationError');
const { BrowserPages } = require('./BrowserPages');
const { BrowserAcceptance } = require('./BrowserAcceptance');
const { releaseBrowserHandles } = require('./releaseBrowserHandles');

/** Native browser acceptance against modules loaded from the installed tarball. */
async function verifyPackedBrowser(packageRoot, execution, example) {
    const examples = {
        counter: () => require(path.join(packageRoot, 'examples/live-html/counter.js')).CounterPage,
        chat: () => require(path.join(packageRoot, 'examples/live-html/chatroom.js')).createChatroomPage(),
        cards: () => require(path.join(packageRoot, 'examples/live-html/cards.js')).CardsPage,
        components: () => require(path.join(packageRoot, 'examples/live-html/components.js')).ComponentsPage,
        jsx: () => require(path.join(packageRoot, 'examples/live-html/jsx-page.js')).JsxPage,
    };
    const selected = example === undefined ? Object.keys(examples) : [example];
    assert.ok(selected.every(name => Object.keys(examples).includes(name)), 'Unknown browser example');
    const executable = process.env.REDWEB_BROWSER || browserCandidates.find(fs.existsSync);
    if (!executable) throw new Error('Chromium is required for packed client/server browser verification.');
    const installed = require(packageRoot);
    const servers = {};
    let browser, failure, launchAttempted = false;
    const record = error => {
        const next = verificationError(error); failure = failure
            ? new AggregateError([failure, next], failure.message, { cause: failure }) : next;
    };
    const bounded = (promise, label) => withTimeout(promise, label, 12000);
    const pages = new BrowserPages(execution, openPage, bounded);
    const recordCleanup = error => { execution.cleanupFailure = verificationError(error); record(error); };
    const evaluate = (tab, expression) => bounded(tab.evaluate(expression), 'packed browser evaluation');
    const wait = (tab, expression, label) => evaluate(tab, eventual(expression, label));
    const report = {
        counter: false, chat: false, reconnect: false, disconnect: false,
        cards: false, components: false, jsx: false, headed: false
    };
    try {
        for (const name of selected) {
            const server = installed.start(examples[name](), { port: 0, bind: '127.0.0.1', logger: null });
            servers[name] = server;
            await bounded(waitForListening(server.server), 'packed server startup');
        }
        launchAttempted = true;
        const launched = await launchBrowserWithRetry(executable, execution.directory, { headless: false });
        browser = launched.browser;
        const port = new URL(launched.endpoint).port;
        const acceptance = new BrowserAcceptance({ pages, debugPort: port, eventual, bounded });
        const origin = server => `http://127.0.0.1:${server.server.address().port}`;
        report.headed = true;
        const metadata = await pages.open(port, 'about:blank');
        report.browser = await bounded(metadata.command('Browser.getVersion'), 'packed browser version');
        if (selected.includes('counter')) {
            const counter = await acceptance.open(origin(servers.counter));
            await acceptance.wait(counter, `Number(document.querySelector('[data-rw-state="count"]').textContent) >= 2`, 'packed server-driven counter');
            await acceptance.style(counter, 'output', 'color', 'rgb(103, 232, 249)');
            report.counter = true;
        }
        if (selected.includes('chat')) {
            const alice = await acceptance.open(origin(servers.chat)), bob = await acceptance.open(origin(servers.chat));
            for (const [tab, name] of [[alice, 'Alice'], [bob, 'Bob']]) {
                await evaluate(tab, `document.querySelector('#display-name').value = ${JSON.stringify(name)}; document.querySelector('form[rw-submit="join"]').requestSubmit();`);
                await wait(tab, 'Boolean(document.querySelector("#chat-message"))', 'packed chat joined');
            }
            await wait(alice, 'document.querySelectorAll(".presence li").length === 2', 'packed chat presence');
            await evaluate(bob, 'document.querySelector("#chat-message").value = "Unsent draft"');
            await evaluate(alice, `document.querySelector('#chat-message').value = '<b>Packed hello</b>'; document.querySelector('form[rw-submit="send"]').requestSubmit();`);
            await wait(bob, 'document.querySelector(".message-list").textContent.includes("<b>Packed hello</b>")', 'packed chat delivery');
            assert.equal(await evaluate(bob, 'document.querySelector("#chat-message").value'), 'Unsent draft');
            assert.equal(await evaluate(bob, 'document.querySelector(".message-list b") === null'), true);
            report.chat = true;
            await evaluate(bob, `(async () => { window.packedPage = (await import('/__redweb/client.js')).mountLivePage(); packedPage.client.close(); })()`);
            await wait(alice, 'document.querySelectorAll(".presence li").length === 1', 'packed closed peer');
            await evaluate(bob, 'packedPage.client.connect()');
            await wait(alice, 'document.querySelectorAll(".presence li").length === 2', 'packed rejoined peer');
            assert.equal(await evaluate(bob, 'document.querySelector("#chat-message").value'), 'Unsent draft');
            report.reconnect = true;
            await bounded(bob.command('Page.navigate', { url: 'about:blank' }), 'packed document departure');
            await wait(alice, 'document.querySelectorAll(".presence li").length === 1', 'packed departed peer');
            report.disconnect = true;
        }
        if (selected.includes('cards')) {
            const cards = await acceptance.open(origin(servers.cards));
            await acceptance.wait(cards, `document.querySelectorAll('.card').length === 2`, 'packed cards readiness');
            await acceptance.evaluate(cards, `document.querySelector('[rw-click="add"]').click()`);
            await acceptance.wait(cards, `document.querySelectorAll('.card').length === 3`, 'packed card action');
            await acceptance.style(cards, '.card', 'backgroundColor', 'rgb(31, 41, 55)');
            report.cards = true;
        }
        if (selected.includes('components')) {
            const components = await acceptance.open(origin(servers.components));
            await acceptance.wait(components, `document.querySelectorAll('button[data-rw-component]').length === 2`, 'packed component readiness');
            await acceptance.evaluate(components, `document.querySelector('button[data-rw-component="primary"]').click()`);
            await acceptance.wait(components, `document.querySelector('output[data-rw-component="primary"]').textContent === '1'`, 'packed component action');
            assert.equal(await acceptance.evaluate(components,
                `document.querySelector('output[data-rw-component="secondary"]').textContent`), '0');
            await acceptance.style(components, '.counter-card', 'backgroundColor', 'rgb(17, 24, 39)');
            report.components = true;
        }
        if (selected.includes('jsx')) {
            const jsxPage = await acceptance.open(origin(servers.jsx), '/jsx');
            await acceptance.evaluate(jsxPage, `document.querySelector('[rw-click="increment"]').click()`);
            await acceptance.wait(jsxPage, `document.querySelector('[rw-click="increment"]')?.textContent.trim() === 'Count 1'`, 'packed JSX action');
            await acceptance.style(jsxPage, '.counter-card', 'backgroundColor', 'rgb(17, 24, 39)');
            report.jsx = true;
        }
    } catch (error) { record(error); }
    finally {
        try { await pages.close(); } catch (error) { recordCleanup(error); }
        try {
            if (browser) {
                await bounded(stopBrowser(browser.child), 'packed browser shutdown');
                assert.ok(browser.child.exitCode !== null || browser.child.signalCode !== null, 'Packed browser termination is uncertain');
            } else if (launchAttempted) throw new Error('Packed browser launch cleanup could not be verified');
        } catch (error) {
            recordCleanup(error);
            releaseBrowserHandles(browser, recordCleanup);
        }
        for (const server of Object.values(servers)) {
            try { await bounded(server.shutdown(), 'packed server shutdown'); }
            catch (error) { recordCleanup(error); }
        }
    }
    if (failure) throw failure;
    return report;
}

module.exports = { verifyPackedBrowser };
