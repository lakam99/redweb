'use strict';

const fs = require('fs');
const path = require('path');
const { npmEntrypoint } = require('./evaluation/process');
const { verifyStarter } = require('./lib/verify-starter');
const { verifyDocumentation } = require('./lib/verify-documentation');
const { verifyActionInput } = require('./lib/verify-action-input');
const { verifyRoomExample } = require('./lib/verify-room-example');
const { verifyExampleDependencies } = require('./lib/verify-example-dependencies');
const { VerificationWorkspace } = require('./lib/VerificationWorkspace');
const { ClientCandidate } = require('./lib/ClientCandidate');
const { createHash } = require('node:crypto');
const { verifyPackedBrowser } = require('./lib/verify-packed-browser');

async function main() {
    const root = path.resolve(__dirname, '..');
    const candidate = process.env.REDWEB_CLIENT_CANDIDATE ? new ClientCandidate(process.env.REDWEB_CLIENT_CANDIDATE) : undefined;
    await new VerificationWorkspace().run(async execution => {
        const workspace = execution.directory;
        const pack = JSON.parse(await execution.command([npmEntrypoint(), 'pack', '--json', '--pack-destination', workspace], { cwd: root }));
        const archive = path.join(workspace, pack[0].filename);
        console.log(JSON.stringify({ redwebArchive: pack[0].filename,
            sha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
            integrity: pack[0].integrity, candidateOnly: Boolean(candidate) }));
        const metadata = require('../package.json');
        const dependencyChecks = await verifyExampleDependencies(archive, workspace, metadata.devDependencies.zod,
            { typescript: metadata.devDependencies.typescript, ws: metadata.dependencies.ws }, execution, candidate);
        if (candidate) {
            for (const [name, digest] of Object.entries(dependencyChecks.candidateEvidence.bundles)) {
                const linkedFile = path.join(path.dirname(require.resolve('redweb-client/live-html')), name);
                if (createHash('sha256').update(fs.readFileSync(linkedFile)).digest('hex') !== digest) {
                    throw new Error('Installed candidate differs from the locally tested client build.');
                }
            }
            console.log(JSON.stringify(dependencyChecks.candidateEvidence));
            const browser = await verifyPackedBrowser(path.join(dependencyChecks.consumer, 'node_modules/redweb'), execution);
            candidate.verify(dependencyChecks.consumer, dependencyChecks.candidateEvidence);
            console.log(JSON.stringify({ candidateOnly: true, packedBrowser: browser }));
        }
        console.log(dependencyChecks.withoutValidator.trim());
        console.log(dependencyChecks.withValidator.trim());
        console.log(dependencyChecks.additions);
        await execution.command(['-xf', archive, '-C', workspace], { executable: 'tar' });
        const packageRoot = path.join(workspace, 'package');
        fs.symlinkSync(path.join(dependencyChecks.consumer, 'node_modules'), path.join(packageRoot, 'node_modules'), 'junction');
        const installed = require(packageRoot);
        const manifest = require(path.join(packageRoot, 'package.json'));
        for (const template of require('../src/cli/templates').TEMPLATES) {
            await verifyStarter(packageRoot, execution, template);
        }
        await verifyDocumentation(packageRoot, execution);
        await verifyActionInput(packageRoot, execution);
        await verifyRoomExample(packageRoot, execution);
        if (manifest.bin.redweb !== 'bin/redweb.js' ||
            !fs.existsSync(path.join(packageRoot, 'bin', 'redweb.js')) ||
            !fs.existsSync(path.join(packageRoot, 'config', 'tsconfig.json'))) {
            throw new Error('Packed initializer or TypeScript preset is missing.');
        }
        const initializedRoot = path.join(workspace, 'initialized-app');
        await execution.command([path.join(packageRoot, 'bin', 'redweb.js'), 'init', initializedRoot]);
        fs.mkdirSync(path.join(initializedRoot, 'node_modules'), { recursive: true });
        fs.symlinkSync(packageRoot, path.join(initializedRoot, 'node_modules', 'redweb'), 'junction');
        fs.symlinkSync(path.dirname(require.resolve('typescript/package.json')), path.join(initializedRoot, 'node_modules', 'typescript'), 'junction');
        await execution.command([require.resolve('typescript/bin/tsc'), '-p', initializedRoot, '--noEmit'], { cwd: initializedRoot });
        const diagnosis = JSON.parse(await execution.command([path.join(packageRoot, 'bin', 'redweb.js'), 'doctor', '--json', '--port', '0'], { cwd: initializedRoot }));
        if (!diagnosis.ok || diagnosis.installedVersion !== manifest.version || diagnosis.source.registrations !== 1 ||
            diagnosis.issues.length !== 1 || diagnosis.issues[0].code !== 'SOURCE_UNRESOLVED' ||
            diagnosis.issues[0].message !== 'Asset templateRoot is not statically known.') {
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
        await execution.command([require.resolve('typescript/bin/tsc'), '-p', consumerRoot], { cwd: consumerRoot });
        await execution.command([path.join(consumerRoot, 'consumer.js')], { cwd: consumerRoot });
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
        if (candidate) candidate.verify(dependencyChecks.consumer, dependencyChecks.candidateEvidence);
        console.log(`Live HTML package gate passed: ${pack[0].filename} extracted, loaded, and rendered in isolation${candidate ? ' (explicit local client candidate; not registry-release evidence)' : ''}.`);
    });
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
