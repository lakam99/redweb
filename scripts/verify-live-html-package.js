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
        if (manifest.bin.redweb !== 'bin/redweb.js' ||
            !fs.existsSync(path.join(packageRoot, 'bin', 'redweb.js')) ||
            !fs.existsSync(path.join(packageRoot, 'config', 'tsconfig.json'))) {
            throw new Error('Packed initializer or TypeScript preset is missing.');
        }
        const initializedRoot = path.join(workspace, 'initialized-app');
        run(process.execPath, [path.join(packageRoot, 'bin', 'redweb.js'), 'init', initializedRoot], { cwd: workspace, shell: false });
        fs.mkdirSync(path.join(initializedRoot, 'node_modules'), { recursive: true });
        fs.symlinkSync(packageRoot, path.join(initializedRoot, 'node_modules', 'redweb'), 'junction');
        fs.symlinkSync(path.dirname(require.resolve('typescript/package.json')), path.join(initializedRoot, 'node_modules', 'typescript'), 'junction');
        run(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', initializedRoot, '--noEmit'], { cwd: initializedRoot, shell: false });
        const diagnosis = JSON.parse(run(process.execPath, [path.join(packageRoot, 'bin', 'redweb.js'), 'doctor', '--json', '--port', '0'], { cwd: initializedRoot, shell: false }));
        if (!diagnosis.ok || diagnosis.issues.length || diagnosis.installedVersion !== manifest.version) {
            throw new Error('Packed doctor did not validate the initialized consumer.');
        }
        if (manifest.scripts['example:counter'] !== 'node examples/live-html/counter.js' ||
            manifest.scripts['example:chatroom'] !== 'node examples/live-html/chatroom.js' ||
            manifest.scripts['example:cards'] !== 'node examples/live-html/cards.js' ||
            manifest.scripts['example:components'] !== 'node examples/live-html/components.js' ||
            manifest.scripts['example:jsx'] !== 'node examples/live-html/jsx-page.js') {
            throw new Error('Packed example commands must run precompiled artifacts without development tooling.');
        }
        const { CounterPage } = require(path.join(packageRoot, 'examples', 'live-html', 'counter.js'));
        const { createChatroomPage } = require(path.join(packageRoot, 'examples', 'live-html', 'chatroom.js'));
        const { CardsPage } = require(path.join(packageRoot, 'examples', 'live-html', 'cards.js'));
        const { ComponentsPage } = require(path.join(packageRoot, 'examples', 'live-html', 'components.js'));
        const { JsxPage } = require(path.join(packageRoot, 'examples', 'live-html', 'jsx-page.js'));
        const examples = [
            installed.start(CounterPage, { listen: false }),
            installed.start(createChatroomPage(), { listen: false }),
            installed.start(CardsPage, { listen: false }),
            installed.start(ComponentsPage, { listen: false }),
            installed.start(JsxPage, { listen: false }),
        ];
        const packedCards = examples[2].manager.records.get('/');
        const renderedCards = await examples[2].manager.render(packedCards, { params: {}, query: {}, body: undefined });
        if ((renderedCards.match(/<article class="card">/g) || []).length !== 2 || !renderedCards.includes('rw-each="cards"')) {
            throw new Error('Packed card collection did not render standard @view metadata.');
        }
        const packedComponents = examples[3].manager.records.get('/');
        const renderedComponents = await examples[3].manager.render(packedComponents, { params: {}, query: {}, body: undefined });
        if ((renderedComponents.match(/data-rw-component="primary"/g) || []).length !== 2 ||
            !renderedComponents.includes('data-rw-component="secondary"')) {
            throw new Error('Packed reusable components did not render isolated instances.');
        }
        await Promise.all(examples.map(server => server.shutdown()));
        const jsxRuntime = require(path.join(packageRoot, 'jsx-runtime.js'));
        const jsxDevRuntime = require(path.join(packageRoot, 'jsx-dev-runtime.js'));
        if (typeof jsxRuntime.jsx !== 'function' || typeof jsxRuntime.jsxs !== 'function' ||
            typeof jsxDevRuntime.jsxDEV !== 'function') {
            throw new Error('Packed JSX runtimes are missing.');
        }
        const consumerRoot = path.join(workspace, 'tsx-consumer');
        fs.mkdirSync(path.join(consumerRoot, 'node_modules'), { recursive: true });
        fs.symlinkSync(packageRoot, path.join(consumerRoot, 'node_modules', 'redweb'), 'junction');
        fs.writeFileSync(path.join(consumerRoot, 'package.json'), JSON.stringify({ type: 'module' }));
        fs.writeFileSync(path.join(consumerRoot, 'tsconfig.json'), JSON.stringify({
            extends: 'redweb/tsconfig.json',
            files: ['consumer.tsx'],
        }));
        fs.writeFileSync(path.join(consumerRoot, 'consumer.tsx'), [
            "import * as fs from 'fs';",
            "import * as path from 'path';",
            "import { component, defineSite, html } from 'redweb';",
            "const Badge = component((props: { label: string }) => <strong>{props.label}</strong>);",
            "const page = <main><Badge label='<Packed>' />{html`<i>HTML</i>`}</main>;",
            "if (page.toString() !== '<main><strong>&lt;Packed&gt;</strong><i>HTML</i></main>') throw new Error('TSX output mismatch');",
            "const site = defineSite({ layout: content => <body><nav>Packed</nav>{content}</body> });",
            "@site.page('/', { head: { title: 'Packed TSX' } })",
            "class Page { render() { return <main><Badge label='Static' /></main>; } }",
            "void (async () => {",
            "  const result = await site.export(Page, { outDir: path.resolve('dist') });",
            "  const document = fs.readFileSync(result.pages[0], 'utf8');",
            "  if (!document.includes('<title>Packed TSX</title>') || !document.includes('<strong>Static</strong>')) throw new Error('TSX static export mismatch');",
            "})().catch(error => { console.error(error); process.exitCode = 1; });",
        ].join('\n'));
        run(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', consumerRoot], { cwd: consumerRoot, shell: false });
        run(process.execPath, [path.join(consumerRoot, 'consumer.js')], { cwd: consumerRoot, shell: false });
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
