'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compileConsumer } = require('../../scripts/lib/compile-consumer');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { browserCandidates, launchBrowserWithRetry, stopBrowser, openPage, eventual } = require('../../scripts/verify-live-html-browser');
const { BrowserPages } = require('../../scripts/lib/BrowserPages');
const { browserCommands } = require('../../scripts/lib/browserCommands');
const { request, withTimeout } = require('../helpers/network');
const root = path.resolve(__dirname, '../..');

test('exact concise TSX examples compile in both decorator modes and work in headed Chrome', async () => {
    await new VerificationWorkspace().run(async execution => {
        const executable = process.env.REDWEB_BROWSER || browserCandidates.find(fs.existsSync);
        if (!executable) throw new Error('A Chromium browser is required for API-example acceptance.');
        const profile = path.join(execution.directory, 'browser'); fs.mkdirSync(profile);
        const { browser, endpoint } = await launchBrowserWithRetry(executable, profile, { headless: false });
        const pages = new BrowserPages(execution, openPage, withTimeout);
        const port = new URL(endpoint).port;
        try {
            for (const legacy of [false, true]) for (const name of ['counter', 'components', 'site']) {
                const source = path.join(execution.directory, `${name}.tsx`);
                // Preserve every printed source line; add only an export so this
                // integration fixture can await and shut down the actual app.
                fs.writeFileSync(source, fs.readFileSync(path.join(root, `docs/snippets/${name}.tsx`), 'utf8') + '\nexport { app };\n');
                const target = path.join(execution.directory, `${name}-${legacy}`);
                const compiled = await compileConsumer(root, execution, target, source, { experimentalDecorators: legacy });
                if (name === 'site') fs.copyFileSync(path.join(root, 'docs/snippets/site.css'), path.join(target, 'dist/site.css'));
                const { app } = require(compiled);
                try {
                    await app.run();
                    const response = await request({ port: 8181 });
                    expect(response.status).toBe(200);
                    const tab = browserCommands(await pages.open(port, 'http://127.0.0.1:8181/'));
                    if (name === 'site') {
                        expect(response.body).not.toContain('__redweb_page');
                        expect(await tab.evaluate("getComputedStyle(document.querySelector('nav')).display")).toBe('flex');
                        await tab.command('Page.navigate', { url: 'http://127.0.0.1:8181/about' });
                        await tab.evaluate(eventual("document.title === 'About' && document.body.textContent.includes('Two pages')", 'about page'));
                    } else {
                        const point = await tab.evaluate("(() => { const r = document.querySelector('button').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
                        await tab.command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
                        await tab.command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
                        await tab.evaluate(eventual("document.querySelector('button').textContent === 'Count 1'", 'server counter update'));
                        if (name === 'components') expect(await tab.evaluate("document.querySelectorAll('button')[1].textContent")).toBe('Count 0');
                        else {
                            const second = browserCommands(await pages.open(port, 'http://127.0.0.1:8181/'));
                            expect(await second.evaluate("document.querySelector('button').textContent")).toBe('Count 1');
                            await second.command('Page.navigate', { url: 'about:blank' });
                        }
                    }
                    await tab.command('Page.navigate', { url: 'about:blank' });
                } finally { await app.shutdown(); }
            }
        } finally {
            try { await pages.close(); } finally { await stopBrowser(browser.child); }
        }
    });
}, 120000);
