'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { browserCandidates, launchBrowserWithRetry, stopBrowser, openPage, eventual } = require('../verify-live-html-browser');
const { withTimeout, waitForListening } = require('../../tests/helpers/network');
const { verificationError } = require('./verificationError');
const { BrowserPages } = require('./BrowserPages');

/** Native browser acceptance against modules loaded from the installed tarball. */
async function verifyPackedBrowser(packageRoot, execution) {
    const executable = process.env.REDWEB_BROWSER || browserCandidates.find(fs.existsSync);
    if (!executable) throw new Error('Chromium is required for packed client/server browser verification.');
    const installed = require(packageRoot);
    const { CounterPage } = require(path.join(packageRoot, 'examples/live-html/counter.js'));
    const { createChatroomPage } = require(path.join(packageRoot, 'examples/live-html/chatroom.js'));
    const servers = [];
    let browser, failure, launchAttempted = false;
    const record = error => { const next = verificationError(error); failure = failure
        ? new AggregateError([failure, next], failure.message, { cause: failure }) : next; };
    const bounded = (promise, label) => withTimeout(promise, label, 12000);
    const pages = new BrowserPages(execution, openPage, bounded);
    const recordCleanup = error => { execution.cleanupFailure = verificationError(error); record(error); };
    const evaluate = (tab, expression) => bounded(tab.evaluate(expression), 'packed browser evaluation');
    const wait = (tab, expression, label) => evaluate(tab, eventual(expression, label));
    const report = { counter: false, chat: false, reconnect: false, disconnect: false };
    try {
        for (const Page of [CounterPage, createChatroomPage()]) {
            const server = installed.start(Page, { port: 0, bind: '127.0.0.1', logger: null });
            servers.push(server);
            await bounded(waitForListening(server.server), 'packed server startup');
        }
        launchAttempted = true;
        const launched = await launchBrowserWithRetry(executable, execution.directory);
        browser = launched.browser;
        const port = new URL(launched.endpoint).port;
        const visit = server => pages.open(port, `http://127.0.0.1:${server.server.address().port}/`);
        const counter = await visit(servers[0]);
        report.browser = await bounded(counter.command('Browser.getVersion'), 'packed browser version');
        await wait(counter, `Number(document.querySelector('[data-rw-state="count"]').textContent) >= 2`, 'packed server-driven counter');
        report.counter = true;
        const alice = await visit(servers[1]), bob = await visit(servers[1]);
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
            for (const release of [() => browser?.child?.stderr?.destroy(), () => browser?.child?.unref()]) {
                try { release(); } catch (error) { recordCleanup(error); }
            }
        }
        for (const server of servers) {
            try { await bounded(server.shutdown(), 'packed server shutdown'); }
            catch (error) { recordCleanup(error); }
        }
    }
    if (failure) throw failure;
    return report;
}

module.exports = { verifyPackedBrowser };
