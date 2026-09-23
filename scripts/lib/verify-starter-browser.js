'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { browserCandidates, launchBrowserWithRetry, stopBrowser, openPage, eventual, combineFailures } = require('../verify-live-html-browser');
const { withTimeout } = require('../../tests/helpers/network');
const { BrowserPages } = require('./BrowserPages');
const { BrowserAcceptance } = require('./BrowserAcceptance');
const { verificationError } = require('./verificationError');
const { releaseBrowserHandles } = require('./releaseBrowserHandles');

/** Headed acceptance for compiled browser-facing starters whose source was removed. */
async function verifyStarterBrowser(execution, template) {
    const executable = process.env.REDWEB_BROWSER || browserCandidates.find(fs.existsSync);
    if (!executable) throw new Error('Chromium is required for generated starter browser verification.');
    const templates = template === undefined ? ['realtime', 'chat', 'site'] : [template];
    assert.ok(templates.every(name => ['realtime', 'chat', 'site'].includes(name)), 'Unknown browser starter');
    const apps = [];
    const origins = {};
    const bounded = (promise, label) => withTimeout(promise, label, 12000);
    const pages = new BrowserPages(execution, openPage, bounded);
    const profile = path.join(execution.directory, 'starter-browser-profile');
    fs.mkdirSync(profile);
    let browser, report, failure, cleanupFailure, launchAttempted = false;
    const recordCleanup = value => {
        const error = verificationError(value);
        cleanupFailure = combineFailures(cleanupFailure, error);
        execution.cleanupFailure = cleanupFailure;
    };
    try {
        for (const template of templates) {
            const root = path.join(execution.directory, template);
            assert.ok(fs.existsSync(path.join(root, 'source-not-deployed')) && !fs.existsSync(path.join(root, 'src')),
                `${template} browser acceptance requires source-removed generated output`);
            const { createApp } = require(path.join(root, 'test/network.cjs'));
            const app = createApp();
            apps.push(app);
            await bounded(app.run(), `${template} starter startup`);
            origins[template] = `http://127.0.0.1:${app.server.address().port}`;
        }
        launchAttempted = true;
        const launched = await launchBrowserWithRetry(executable, profile, { headless: false });
        browser = launched.browser;
        const acceptance = new BrowserAcceptance({ pages, debugPort: new URL(launched.endpoint).port, eventual, bounded });
        report = { headed: true };

        if (templates.includes('realtime')) {
            const firstCounter = await acceptance.open(origins.realtime);
            const secondCounter = await acceptance.open(origins.realtime);
            await acceptance.wait(firstCounter, `document.documentElement.getAttribute('data-rw-connection') === 'open'`, 'realtime starter connection');
            await acceptance.wait(secondCounter, `document.documentElement.getAttribute('data-rw-connection') === 'open'`, 'second realtime starter connection');
            await acceptance.evaluate(firstCounter, `document.querySelector('[rw-click="increment"]').click()`);
            for (const page of [firstCounter, secondCounter]) {
                await acceptance.wait(page, `document.querySelector('[rw-click="increment"]')?.textContent.trim() === 'Count 1'`, 'shared starter counter action');
            }
            await acceptance.style(firstCounter, 'button', 'backgroundColor', 'rgb(255, 80, 100)');
            report.realtime = true;
        }

        if (templates.includes('chat')) {
            const alice = await acceptance.open(origins.chat);
            const bob = await acceptance.open(origins.chat);
            for (const [page, name] of [[alice, 'Alice'], [bob, 'Bob']]) {
                await acceptance.evaluate(page, `document.querySelector('#display-name').value = ${JSON.stringify(name)}; document.querySelector('form[rw-submit="join"]').requestSubmit()`);
                await acceptance.wait(page, `Boolean(document.querySelector('#chat-message'))`, `${name} starter chat join`);
            }
            await acceptance.wait(alice, `document.querySelectorAll('.presence li').length === 2`, 'starter chat presence');
            await acceptance.evaluate(alice, `document.querySelector('#chat-message').value = 'Headed starter hello'; document.querySelector('form[rw-submit="send"]').requestSubmit()`);
            await acceptance.wait(bob, `document.querySelector('.message-list').textContent.includes('Headed starter hello')`, 'starter chat delivery');
            await acceptance.style(alice, '.composer button', 'backgroundColor', 'rgb(34, 211, 238)');
            await bounded(alice.command('Page.navigate', { url: 'about:blank' }), 'starter chat departure');
            await acceptance.wait(bob, `document.querySelectorAll('.presence li').length === 1`, 'starter chat disconnect');
            report.chat = true;
        }

        if (templates.includes('site')) {
            const home = await acceptance.open(origins.site);
            assert.equal(await acceptance.evaluate(home, `Boolean(document.querySelector('nav a[href="/about"]')) && !document.querySelector('script') && !document.getElementById('__redweb_page')`), true);
            await acceptance.style(home, 'nav a', 'color', 'rgb(255, 135, 149)');
            const about = await acceptance.open(origins.site, '/about');
            assert.equal(await acceptance.evaluate(about, `document.querySelector('h1').textContent === 'About' && document.title === 'About' && !document.querySelector('script')`), true);
            report.site = true;
        }
    } catch (error) { failure = verificationError(error); }
    finally {
        try { await pages.close(); } catch (error) { recordCleanup(error); }
        try {
            if (browser) {
                await bounded(stopBrowser(browser.child), 'starter browser shutdown');
                assert.ok(browser.child.exitCode !== null || browser.child.signalCode !== null, 'Starter browser termination is uncertain');
            } else if (launchAttempted) throw new Error('Starter browser launch cleanup could not be verified');
        } catch (error) {
            recordCleanup(error);
            releaseBrowserHandles(browser, recordCleanup);
        }
        for (const app of apps) {
            try { await bounded(app.shutdown(), 'starter application shutdown'); }
            catch (error) { recordCleanup(error); }
        }
    }
    if (failure) throw combineFailures(failure, cleanupFailure);
    if (cleanupFailure) throw cleanupFailure;
    console.log(`Generated starter browser gate passed: headed ${templates.join(', ')} behavior from compiled source-removed output.`);
    return report;
}

module.exports = { verifyStarterBrowser };
