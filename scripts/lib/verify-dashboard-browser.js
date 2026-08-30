'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { verifyStarter } = require('./verify-starter');

async function waitForPage(page, expression) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
        try { if (await page.evaluate(expression)) return; }
        catch (error) { if (!/context|navigat|object.*found/i.test(error.message)) throw error; }
        await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error(`Dashboard browser condition failed: ${expression}`);
}

async function verifyDashboardBrowser({ openPage, debugPort }) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-dashboard-browser-'));
    const pages = [];
    let app;
    try {
        assert.doesNotMatch(verifyStarter(path.resolve(__dirname, '../..'), workspace, 'dashboard'), /# SKIP/);
        const root = path.join(workspace, 'dashboard');
        const { createApp } = require(path.join(root, 'dist/app'));
        const { DashboardStore } = require(path.join(root, 'dist/store'));
        const { credentials } = require(path.join(root, 'dist/auth'));
        const database = path.join(workspace, 'browser.sqlite');
        const store = new DashboardStore(database);
        try { store.provision('alice', await credentials('browser-test-only-password')); }
        finally { store.close(); }
        app = createApp({ port: 0, database });
        await once(app.server, 'listening');
        const origin = `http://127.0.0.1:${app.server.address().port}`;
        const first = await openPage(debugPort, `${origin}/login`); pages.push(first);
        const signIn = async page => {
            await page.evaluate(`document.querySelector('#account').value = 'alice'; document.querySelector('#password').value = 'browser-test-only-password'; document.querySelector('form').requestSubmit();`);
            await waitForPage(page, `Boolean(document.querySelector('#card-title')) && document.documentElement.getAttribute('data-rw-connection') === 'open'`);
        };
        await signIn(first);
        const second = await openPage(debugPort, origin); pages.push(second);
        await second.evaluate(`window.savedInput = document.querySelector('#card-title'); savedInput.value = 'Unsent draft'; savedInput.focus(); savedInput.setSelectionRange(2, 5);`);
        await first.evaluate(`document.querySelector('#card-title').value = 'Browser saved card'; document.querySelector('[rw-submit="add"]').requestSubmit();`);
        for (const page of pages) await waitForPage(page, `document.querySelector('.card-grid h2')?.textContent === 'Browser saved card'`);
        assert.ok(await second.evaluate(`savedInput === document.querySelector('#card-title') && savedInput.value === 'Unsent draft' && document.activeElement === savedInput && savedInput.selectionStart === 2`));
        assert.equal(await first.evaluate(`document.cookie.includes('redweb_dashboard')`), false, 'Session cookie must remain HttpOnly.');
        await first.evaluate(`document.querySelector('form[action="/logout"]').requestSubmit();`);
        await waitForPage(first, `Boolean(document.querySelector('#account'))`);
        await waitForPage(second, `document.documentElement.getAttribute('data-rw-connection') !== 'open'`);
        assert.equal(await second.evaluate(`fetch('/').then(response => response.status)`), 401);
        await signIn(first);
        assert.equal(await first.evaluate(`document.querySelector('.card-grid h2').textContent`), 'Browser saved card');
        await first.evaluate(`document.querySelector('[rw-submit="remove"]').requestSubmit();`);
        await waitForPage(first, `document.querySelectorAll('.card-grid li').length === 0`);
        console.log('Dashboard browser passed: real sign-in/forms, private live cards, draft preservation, HttpOnly cookies, sign-out/re-login and deletion.');
    } finally {
        for (const page of pages) {
            await page.command('Page.close').catch(() => {});
            page.socket.close();
        }
        await app?.shutdown();
        fs.rmSync(workspace, { recursive: true, force: true });
    }
}

module.exports = { verifyDashboardBrowser };
