'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { verifyStarter } = require('./verify-starter');
const { VerificationWorkspace } = require('./VerificationWorkspace');
const { withTimeout } = require('../../tests/helpers/network');
const { verificationError } = require('./verificationError');

const evaluate = (page, expression) => withTimeout(page.evaluate(expression), 'dashboard browser evaluation', 8000);

async function waitForPage(page, expression) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
        try { if (await evaluate(page, expression)) return; }
        catch (error) { if (!/context|navigat|object.*found/i.test(error.message)) throw error; }
        await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error(`Dashboard browser condition failed: ${expression}`);
}

async function verifyDashboardBrowser({ openPage, debugPort }) {
    return new VerificationWorkspace().run(execution => verifyDashboard(execution, { openPage, debugPort }));
}

async function verifyDashboard(execution, { openPage, debugPort }) {
    const workspace = execution.directory;
    const pages = [];
    const openings = [];
    const cleanup = [];
    let app, failure, closing = false;
    const closePage = async page => {
        try { await withTimeout(page.command('Page.close'), 'dashboard page close', 5000); }
        finally { page.socket.terminate(); }
    };
    const open = async url => {
        const opening = { settled: false };
        opening.promise = Promise.resolve().then(() => openPage(debugPort, url)).then(async page => {
            if (closing) {
                try { await closePage(page); }
                catch (error) { cleanup.push(error); }
            } else pages.push(page);
            return page;
        }).finally(() => { opening.settled = true; });
        openings.push(opening);
        return withTimeout(opening.promise, 'dashboard page open', 10000);
    };
    try {
        assert.doesNotMatch(await verifyStarter(path.resolve(__dirname, '../..'), execution, 'dashboard'), /# SKIP/);
        const root = path.join(workspace, 'dashboard');
        const { createApp } = require(path.join(root, 'dist/app'));
        const { DashboardStore } = require(path.join(root, 'dist/store'));
        const { credentials } = require(path.join(root, 'dist/auth'));
        const database = path.join(workspace, 'browser.sqlite');
        const store = new DashboardStore(database);
        try { store.provision('alice', await credentials('browser-test-only-password')); }
        finally { store.close(); }
        app = createApp({ port: 0, database, signals: false });
        await app.run();
        // Use the browser-equivalent loopback name that the server does not print.
        // This caught a real form/socket rejection hidden by synthetic Origin headers.
        const origin = `http://localhost:${app.server.address().port}`;
        const first = await open(`${origin}/login`);
        const signIn = async page => {
            await evaluate(page, `document.querySelector('#account').value = 'alice'; document.querySelector('#password').value = 'browser-test-only-password'; document.querySelector('form').requestSubmit();`);
            await waitForPage(page, `Boolean(document.querySelector('#card-title')) && document.documentElement.getAttribute('data-rw-connection') === 'open'`);
        };
        await evaluate(first, `document.querySelector('#account').value = 'alice'; document.querySelector('#password').value = 'incorrect-browser-password'; document.querySelector('form').requestSubmit();`);
        await waitForPage(first, `document.body.textContent.includes('Check your credentials')`);
        await first.command('Page.navigate', { url: `${origin}/login` });
        await waitForPage(first, `Boolean(document.querySelector('#account'))`);
        await signIn(first);
        const second = await open(origin);
        await evaluate(second, `window.savedInput = document.querySelector('#card-title'); savedInput.value = 'Unsent draft'; savedInput.focus(); savedInput.setSelectionRange(2, 5);`);
        await evaluate(first, `document.querySelector('#card-title').value = 'Browser saved card'; document.querySelector('[rw-submit="add"]').requestSubmit();`);
        for (const page of pages) await waitForPage(page, `document.querySelector('.card-grid h2')?.textContent === 'Browser saved card'`);
        assert.ok(await evaluate(second, `savedInput === document.querySelector('#card-title') && savedInput.value === 'Unsent draft' && document.activeElement === savedInput && savedInput.selectionStart === 2`));
        assert.equal(await evaluate(first, `document.cookie.includes('redweb_dashboard')`), false, 'Session cookie must remain HttpOnly.');
        await evaluate(first, `document.querySelector('form[action="/logout"]').requestSubmit();`);
        await waitForPage(first, `Boolean(document.querySelector('#account'))`);
        await waitForPage(second, `document.documentElement.getAttribute('data-rw-connection') !== 'open'`);
        assert.equal(await evaluate(second, `fetch('/').then(response => response.status)`), 401);
        await signIn(first);
        assert.equal(await evaluate(first, `document.querySelector('.card-grid h2').textContent`), 'Browser saved card');
        await evaluate(first, `document.querySelector('[rw-submit="remove"]').requestSubmit();`);
        await waitForPage(first, `document.querySelectorAll('.card-grid li').length === 0`);
        console.log('Dashboard browser passed: real rejected/accepted browser sign-in forms across localhost, private live cards, draft preservation, HttpOnly cookies, sign-out/re-login and deletion.');
    } catch (error) { failure = verificationError(error); }
    closing = true;
    await Promise.allSettled(openings.map(opening => withTimeout(opening.promise, 'dashboard pending page open', 10000)));
    // A rejected opening is already the primary failure; an unsettled opening is
    // uncertain ownership and must prevent temporary workspace removal.
    if (openings.some(opening => !opening.settled)) {
        cleanup.push(new Error('Dashboard page creation did not settle during cleanup.'));
    }
    try {
        for (const page of pages) {
            try { await closePage(page); }
            catch (error) { cleanup.push(error); }
        }
    } finally {
        try { if (app) await withTimeout(app.shutdown(), 'dashboard application shutdown', 15000); }
        catch (error) {
            cleanup.push(error);
            try { app.server.unref(); }
            catch (error) { cleanup.push(error); }
        }
    }
    if (cleanup.length) execution.cleanupFailure = new AggregateError(cleanup, 'Dashboard cleanup failed');
    if (failure) throw failure;
}

module.exports = { verifyDashboardBrowser, verifyDashboard };
