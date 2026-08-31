'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { npmEntrypoint } = require('./evaluation/process');
const { verifyStarter } = require('./lib/verify-starter');
const { verifyDocumentation } = require('./lib/verify-documentation');
const { verifyActionInput } = require('./lib/verify-action-input');
const { verifyRoomExample } = require('./lib/verify-room-example');
const { verifyExampleDependencies } = require('./lib/verify-example-dependencies');
const { VerificationWorkspace } = require('./lib/VerificationWorkspace');
const { ClientCandidate } = require('./lib/ClientCandidate');
const { createHash, randomUUID } = require('node:crypto');
const { verifyPackedBrowser } = require('./lib/verify-packed-browser');
const { PackedBrowserHarness } = require('./lib/PackedBrowserHarness');
const { preservePackedBrowserReport } = require('./lib/preservePackedBrowserReport');
const { verificationError } = require('./lib/verificationError');
const { combineFailures } = require('./verify-live-html-browser');
const { withTimeout } = require('../tests/helpers/network');
const bounded = (promise, label) => withTimeout(promise, label, 15000);

// Register each returned instance before the next constructor or render runs.
// Both example batches and individual smoke servers use the same cleanup owner.
async function withServers(execution, operation) {
    const servers = [];
    let failure;
    try { await operation(server => { servers.push(server); return server; }); }
    catch (error) { failure = verificationError(error); }
    for (const server of servers) {
        try { await bounded(server.shutdown(), 'packed smoke server shutdown'); }
        catch (error) {
            const cleanup = verificationError(error);
            execution.cleanupFailure = combineFailures(execution.cleanupFailure, cleanup);
            failure = combineFailures(failure, cleanup);
        }
    }
    if (failure) throw failure;
}

async function main() {
    const root = path.resolve(__dirname, '..');
    const candidate = process.env.REDWEB_CLIENT_CANDIDATE ? new ClientCandidate(process.env.REDWEB_CLIENT_CANDIDATE) : undefined;
    const filename = await new VerificationWorkspace().run(async execution => {
        const workspace = execution.directory;
        const pack = JSON.parse(await execution.command([npmEntrypoint(), 'pack', '--json', '--pack-destination', workspace], { cwd: root }));
        const archive = path.join(workspace, pack[0].filename);
        console.log(JSON.stringify({ redwebArchive: pack[0].filename,
            sha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
            integrity: pack[0].integrity, candidateOnly: Boolean(candidate) }));
        const metadata = require('../package.json');
        const dependencyChecks = await verifyExampleDependencies(archive, workspace, metadata.devDependencies.zod,
            { typescript: metadata.devDependencies.typescript, ws: metadata.dependencies.ws }, execution, candidate);
        {
            if (!candidate) {
                const locked = require('../package-lock.json').packages['node_modules/redweb-client'];
                const installed = dependencyChecks.clientEvidence;
                assert.deepEqual([installed.clientVersion, installed.resolved, installed.integrity],
                    [locked.version, locked.resolved, locked.integrity], 'Registry client must match the committed dependency lock');
            }
            for (const [name, digest] of Object.entries(dependencyChecks.clientEvidence.bundles)) {
                const linkedFile = path.join(path.dirname(require.resolve('redweb-client/live-html')), name);
                if (createHash('sha256').update(fs.readFileSync(linkedFile)).digest('hex') !== digest) {
                    throw new Error('Installed client differs from the locally tested client build.');
                }
            }
            console.log(JSON.stringify(dependencyChecks.clientEvidence));
            let browser, failure;
            try { browser = await verifyPackedBrowser(path.join(dependencyChecks.consumer, 'node_modules/redweb'), execution); }
            catch (error) { failure = verificationError(error); }
            try { dependencyChecks.verifyClient(dependencyChecks.clientEvidence); }
            catch (error) { failure = combineFailures(failure, verificationError(error)); }
            if (failure) throw failure;
            console.log(JSON.stringify({ candidateOnly: Boolean(candidate), packedBrowser: browser }));
        }
        console.log(dependencyChecks.withoutValidator.trim());
        console.log(dependencyChecks.withValidator.trim());
        console.log(dependencyChecks.additions);
        await execution.command(['-xf', archive, '-C', workspace], { executable: 'tar' });
        const packageRoot = path.join(workspace, 'package');
        fs.symlinkSync(path.join(dependencyChecks.consumer, 'node_modules'), path.join(packageRoot, 'node_modules'), 'junction');
        {
            const harness = new PackedBrowserHarness(packageRoot, root);
            const environment = { TEMP: workspace, TMP: workspace, TMPDIR: workspace, NODE_OPTIONS: '' };
            const reportDirectory = path.join(root, 'coverage/packed-browser', randomUUID());
            fs.mkdirSync(reportDirectory, { recursive: true });
            const report = { redwebArchiveSha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
                client: dependencyChecks.clientEvidence, phases: [], status: 'failed' };
            let failure;
            try {
                for (const [name, args] of [
                    ['acceptance', ['scripts/verify-live-html-browser.js']],
                    ['runtime', ['scripts/verify-browser-coverage.js', 'runtime']],
                    ['refresh', ['scripts/verify-browser-coverage.js', 'refresh']],
                ]) {
                    const output = await execution.command(args, { cwd: packageRoot, environment, timeoutMs: 180000 });
                    fs.writeFileSync(path.join(reportDirectory, `${name}.log`), output);
                    console.log(output);
                    harness.verify();
                    dependencyChecks.verifyClient(dependencyChecks.clientEvidence);
                    report.phases.push(name);
                }
                const runtime = JSON.parse(fs.readFileSync(path.join(packageRoot, 'coverage/browser-runtime/report.json'), 'utf8'));
                if (runtime.bundleSha256 !== report.client.bundles['live-html.js']) throw new Error('Browser report measured a different client candidate');
                report.status = 'passed';
            } catch (error) { failure = verificationError(error); }
            try {
                report.inputs = harness.verify();
                dependencyChecks.verifyClient(dependencyChecks.clientEvidence);
            } catch (error) { failure = combineFailures(failure, verificationError(error)); }
            failure = preservePackedBrowserReport(report, reportDirectory, path.join(packageRoot, 'coverage'), failure);
            console.log(JSON.stringify({ candidateOnly: Boolean(candidate), packedRegressions: report, reportDirectory }));
            if (failure) {
                failure.reportDirectory = reportDirectory;
                throw failure;
            }
        }
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
        await withServers(execution, async own => {
            const examples = [
                own(installed.start(CounterPage, { listen: false })),
                own(installed.start(createChatroomPage(), { listen: false })),
                own(installed.start(CardsPage, { listen: false })),
                own(installed.start(ComponentsPage, { listen: false })),
                own(installed.start(JsxPage, { listen: false })),
            ];
            const packedCards = examples[2].manager.records.get('/');
            const renderedCards = await bounded(examples[2].manager.render(packedCards, { params: {}, query: {}, body: undefined }), 'packed card rendering');
            if ((renderedCards.match(/<article class="card">/g) || []).length !== 2 || !renderedCards.includes('rw-each="cards"')) {
                throw new Error('Packed card collection did not render standard @view metadata.');
            }
            const packedComponents = examples[3].manager.records.get('/');
            const renderedComponents = await bounded(examples[3].manager.render(packedComponents, { params: {}, query: {}, body: undefined }), 'packed component rendering');
            if ((renderedComponents.match(/data-rw-component="primary"/g) || []).length !== 2 ||
                !renderedComponents.includes('data-rw-component="secondary"')) {
                throw new Error('Packed reusable components did not render isolated instances.');
            }
        });
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
        await withServers(execution, async own => {
            const server = own(new installed.LiveHtmlServer({ pages: [SmokePage], listen: false }));
            const runtime = server.manager.records.get('/');
            if (!runtime || !require.resolve('redweb-client', { paths: [packageRoot] })) {
                throw new Error('Packed Live HTML runtime or client dependency is missing.');
            }
            const rendered = await bounded(server.manager.render(runtime, { params: {}, query: {}, body: undefined }), 'packed smoke rendering');
            if (!rendered.includes('data-rw-state="message">packed</span>')) {
                throw new Error('Packed Live HTML server did not render decorated state.');
            }
        });
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
        dependencyChecks.verifyClient(dependencyChecks.clientEvidence);
        return pack[0].filename;
    });
    console.log(`Live HTML package gate passed: ${filename} extracted, loaded, and rendered in isolation${candidate ? ' (explicit local client candidate; not registry-release evidence)' : ''}.`);
}

if (require.main === module) main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

module.exports = { main, withServers };
