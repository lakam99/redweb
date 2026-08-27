'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        encoding: 'utf8',
        shell: process.platform === 'win32',
        ...options,
    });
    if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
    return result.stdout;
}

async function main() {
    const root = path.resolve(__dirname, '..');
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-live-package-'));
    try {
        const pack = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', workspace], { cwd: root }));
        const archive = path.join(workspace, pack[0].filename);
        run('tar', ['-xf', archive, '-C', workspace]);
        const packageRoot = path.join(workspace, 'package');
        fs.symlinkSync(path.join(root, 'node_modules'), path.join(packageRoot, 'node_modules'), 'junction');
        const installed = require(packageRoot);
        const manifest = require(path.join(packageRoot, 'package.json'));
        if (manifest.scripts['example:counter'] !== 'node examples/live-html/counter.js' ||
            manifest.scripts['example:chatroom'] !== 'node examples/live-html/chatroom.js' ||
            manifest.scripts['example:cards'] !== 'node examples/live-html/cards.js') {
            throw new Error('Packed example commands must run precompiled artifacts without development tooling.');
        }
        const { CounterPage } = require(path.join(packageRoot, 'examples', 'live-html', 'counter.js'));
        const { ChatroomPage } = require(path.join(packageRoot, 'examples', 'live-html', 'chatroom.js'));
        const { CardsPage } = require(path.join(packageRoot, 'examples', 'live-html', 'cards.js'));
        const examples = [
            installed.start(CounterPage, { listen: false }),
            installed.start(ChatroomPage, { listen: false }),
            installed.start(CardsPage, { listen: false }),
        ];
        const packedCards = examples[2].manager.records.get('/');
        const renderedCards = await examples[2].manager.render(packedCards, { params: {}, query: {}, body: undefined });
        if ((renderedCards.match(/<article class="card">/g) || []).length !== 2 || !renderedCards.includes('rw-each="cards"')) {
            throw new Error('Packed card collection did not render standard @view metadata.');
        }
        await Promise.all(examples.map(server => server.shutdown()));
        class SmokePage extends installed.LivePage {
            constructor() {
                super();
                this.message = 'packed';
            }
            render() { return '<p>{{ message }}</p>'; }
        }
        installed.state()(SmokePage.prototype, 'message');
        installed.page('/')(SmokePage);
        const server = new installed.LiveHtmlServer({ pages: [SmokePage], listen: false });
        const runtime = server.manager.records.get('/');
        if (!runtime || !require.resolve('redweb-client', { paths: [packageRoot] })) {
            throw new Error('Packed Live HTML runtime or client dependency is missing.');
        }
        const rendered = await server.manager.render(runtime, { params: {}, query: {}, body: undefined });
        if (!rendered.includes('data-rw-state="message">packed</span>')) {
            throw new Error('Packed Live HTML server did not render decorated state.');
        }
        await server.shutdown();
        const composed = installed.codeBlock(
            installed.each(['API'], item => installed.html`<a id="${installed.attribute('api')}" href="${installed.url('#api')}">${item}</a>`),
            { language: 'html' }
        ).toString();
        if (!composed.includes('id="api"') || !composed.includes('href="#api"')) {
            throw new Error('Packed documentation composition helpers did not render.');
        }
        class StaticSmokePage {
            render() { return '<html><body><h1>Static package</h1></body></html>'; }
        }
        installed.page('/docs', { live: false, head: { title: 'Packed docs' } })(StaticSmokePage);
        const staticRoot = path.join(workspace, 'static-output');
        const staticResult = await installed.exportStatic(StaticSmokePage, { outDir: staticRoot });
        const staticDocument = fs.readFileSync(staticResult.pages[0], 'utf8');
        if (!staticDocument.includes('<title>Packed docs</title>') || staticDocument.includes('__redweb_page')) {
            throw new Error('Packed static exporter did not emit a standalone document.');
        }
        console.log(`Live HTML package gate passed: ${pack[0].filename} extracted, loaded, and rendered in isolation.`);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
