'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { isNativeError } = require('node:util/types');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const filename = path.resolve(__dirname, '../../scripts/verify-live-html-package.js');
const root = path.dirname(path.dirname(filename));
const leaves = error => Array.isArray(error?.errors) ? error.errors.flatMap(leaves) : [error];
const hash = text => createHash('sha256').update(text).digest('hex');

// Explicit dependency-boundary units, not simulated package acceptance. The
// separate integration invokes the canonical complete isolated-package gate.
async function exercise(mode) {
    const primary = new Error('unit primary'), cleanup = new Error('unit cleanup');
    const directory = path.join(root, 'unit-package-workspace'), packageRoot = path.join(directory, 'package');
    const owner = { directory, cleanupFailure: null }, printed = [], events = [], reports = [], errors = [];
    const files = new Map(), instances = [];
    const metadata = JSON.parse(JSON.stringify(require('../../package.json')));
    const locked = require('../../package-lock.json').packages['node_modules/redweb-client'];
    const client = { clientVersion: locked.version, resolved: locked.resolved, integrity: locked.integrity,
        bundles: { 'live-html.js': hash('unit bundle') } };
    if (mode === 'client-lock') client.integrity = 'wrong';
    let clientChecks = 0, harnessChecks = 0;
    const diagnosis = { ok: true, installedVersion: metadata.version, source: { registrations: 1 },
        issues: [{ code: 'SOURCE_UNRESOLVED', message: 'Asset templateRoot is not statically known.' }] };
    if (mode.startsWith('doctor-')) {
        const kind = mode.slice(7);
        if (kind === 'ok') diagnosis.ok = false;
        if (kind === 'version') diagnosis.installedVersion = '0.0.0';
        if (kind === 'registrations') diagnosis.source.registrations = 0;
        if (kind === 'issues') diagnosis.issues = [];
        if (kind === 'code') diagnosis.issues[0].code = 'WRONG';
        if (kind === 'message') diagnosis.issues[0].message = 'wrong';
    }
    if (mode === 'manifest-bin') metadata.bin.redweb = 'missing';
    if (mode.startsWith('command-')) metadata.scripts['example:' + mode.slice(8)] = 'wrong';
    owner.command = async args => {
        if (mode === 'cli') throw primary;
        if (args.includes('pack')) return JSON.stringify([{ filename: 'redweb.tgz', integrity: 'unit archive' }]);
        if (args.includes('doctor')) return JSON.stringify(diagnosis);
        if (args[0] === 'scripts/verify-live-html-browser.js') {
            if (mode === 'phase-undefined') throw undefined;
            if (mode === 'phase-error') throw primary;
        }
        return 'unit command output';
    };
    const fakeFs = { mkdirSync() {}, symlinkSync() {},
        existsSync: file => !(mode === 'missing-bin' && file.endsWith(path.join('bin', 'redweb.js')))
            && !(mode === 'missing-preset' && file.endsWith(path.join('config', 'tsconfig.json'))),
        readFileSync(file) {
            if (file.endsWith('redweb.tgz')) return Buffer.from('unit archive');
            if (file.endsWith('live-html.js')) return Buffer.from(mode === 'client-bytes' ? 'wrong' : 'unit bundle');
            if (file.endsWith(path.join('browser-runtime', 'report.json'))) return JSON.stringify({ bundleSha256: mode === 'runtime-bytes' ? 'wrong' : hash('unit bundle') });
            if (files.has(file)) return files.get(file);
            throw new Error('Unexpected unit read: ' + file);
        },
        writeFileSync(file, value) { files.set(file, String(value)); },
    };
    const server = index => {
        const instance = { manager: { records: new Map([['/', {}]]), render: async () => {
            if (index === 2) {
                if (mode === 'cards-render') throw primary;
                if (mode === 'cards-empty') return '';
                if (mode === 'cards-count') return '<article class="card">';
                return '<article class="card"><article class="card">' + (mode === 'cards-metadata' ? '' : 'rw-each="cards"');
            }
            if (index === 3) {
                if (mode === 'components-empty') return '';
                if (mode === 'components-count') return 'data-rw-component="primary"';
                return 'data-rw-component="primary" data-rw-component="primary"' + (mode === 'components-metadata' ? '' : ' data-rw-component="secondary"');
            }
            if (mode === 'smoke-render') throw primary;
            return mode === 'smoke-markup' ? '' : 'data-rw-state="message">packed</span>';
        } }, shutdown() {
            events.push('close:' + index);
            if (mode === 'close-sync' && index === 0) throw cleanup;
            if (mode === 'close-reject' && index === 0) return Promise.reject(cleanup);
            if (mode === 'close-many' && index < 2) return Promise.reject(index ? cleanup : primary);
            if (mode === 'smoke-close' && index === 5) return Promise.reject(cleanup);
            return Promise.resolve();
        } };
        if (index === 5 && mode === 'smoke-runtime') instance.manager.records.clear();
        instances.push(instance); return instance;
    };
    const installed = { LivePage: class {},
        start() { const index = instances.length; if (mode === 'partial-start' && index === 2) throw primary; return server(index); },
        LiveHtmlServer: class { constructor() { return server(5); } },
        state: () => () => {}, page: () => () => {},
        html: (strings, ...values) => strings.reduce((output, part, index) => output + part + (values[index] ?? ''), ''),
        each: (items, render) => items.map(render).join(''), attribute: value => value, url: value => value,
        codeBlock: value => ({ toString: () => mode === 'composition-id' ? 'href="#api"' : mode === 'composition-link' ? 'id="api"' : value }),
        exportStatic: async Page => {
            new Page().render();
            const file = path.join(directory, 'static.html');
            files.set(file, mode === 'static-title' ? '' : '<title>Packed docs</title>' + (mode === 'static-live' ? '__redweb_page' : ''));
            return { pages: [file] };
        },
    };
    const nativeRequire = createRequire(filename);
    const dependencies = {
        fs: fakeFs,
        '../package.json': metadata,
        './lib/ClientCandidate': { ClientCandidate: class {} },
        './lib/VerificationWorkspace': { VerificationWorkspace: class { async run(operation) {
            const value = await operation(owner);
            if (mode === 'workspace-cleanup') throw cleanup;
            return value;
        } } },
        './lib/verify-example-dependencies': { verifyExampleDependencies: async () => ({ consumer: path.join(directory, 'consumer'),
            clientEvidence: client, withoutValidator: 'without validator', withValidator: 'with validator', additions: 'additions',
            verifyClient() {
                clientChecks++;
                if (mode === 'client-null' && clientChecks === 1) throw null;
                if (mode === 'browser-and-client' && clientChecks === 1) throw cleanup;
                if (mode === 'final-client' && clientChecks === 6) throw primary;
            },
        }) },
        './lib/verify-packed-browser': { verifyPackedBrowser: async () => {
            if (mode === 'browser-undefined') throw undefined;
            if (mode === 'browser-null') throw null;
            if (mode === 'browser-error' || mode === 'browser-and-client') throw primary;
            return { counter: true, chat: true };
        } },
        './lib/PackedBrowserHarness': { PackedBrowserHarness: class { verify() {
            if (++harnessChecks === 4 && mode === 'harness-null') throw null;
            return { unit: true };
        } } },
        './lib/preservePackedBrowserReport': { preservePackedBrowserReport(report, _directory, _coverage, failure) {
            if (failure) { report.status = 'failed'; report.error = failure.message; }
            reports.push(JSON.parse(JSON.stringify(report))); return failure;
        } },
        './lib/verify-starter': { verifyStarter: async () => {} },
        './lib/verify-starter-browser': { verifyStarterBrowser: async () => ({ realtime: true, chat: true, site: true, headed: true }) },
        './lib/verify-documentation': { verifyDocumentation: async () => {} },
        './lib/verify-action-input': { verifyActionInput: async () => {} },
        './lib/verify-room-example': { verifyRoomExample: async () => {} },
        [packageRoot]: installed,
        [path.join(packageRoot, 'package.json')]: metadata,
        [path.join(packageRoot, 'jsx-runtime.js')]: { jsx: mode === 'jsx' ? undefined : () => {}, jsxs: mode === 'jsxs' ? undefined : () => {} },
        [path.join(packageRoot, 'jsx-dev-runtime.js')]: { jsxDEV: mode === 'jsxDEV' ? undefined : () => {} },
    };
    for (const [file, exported] of [['counter', 'CounterPage'], ['cards', 'CardsPage'], ['components', 'ComponentsPage'], ['jsx-page', 'JsxPage']]) {
        dependencies[path.join(packageRoot, 'examples', 'live-html', file + '.js')] = { [exported]: class {} };
    }
    dependencies[path.join(packageRoot, 'examples', 'live-html', 'chatroom.js')] = { createChatroomPage: () => class {} };
    const requireBoundary = name => Object.hasOwn(dependencies, name) ? dependencies[name] : nativeRequire(name);
    requireBoundary.resolve = nativeRequire.resolve;
    const context = { require: requireBoundary, module: { exports: {} }, __dirname: path.dirname(filename),
        process: { env: mode === 'candidate' ? { REDWEB_CLIENT_CANDIDATE: 'unit-client.tgz' } : {}, exitCode: 0 },
        console: { log(value) { printed.push(String(value)); }, error(error) { errors.push(error); } } };
    if (mode === 'cli') requireBoundary.main = context.module;
    vm.runInNewContext(createInstrumenter().instrumentSync(fs.readFileSync(filename, 'utf8'), filename), context, { filename });
    let failed = false;
    let result;
    if (mode === 'cli') {
        await new Promise(resolve => setImmediate(resolve));
        failed = errors.length > 0; result = errors[0];
    } else result = await context.module.exports.main().catch(error => { failed = true; return error; });
    if (process.argv.includes('--collectCoverageFrom=scripts/verify-live-html-package.js')) {
        const combined = createCoverageMap(globalThis.__coverage__ || {});
        combined.merge(context.__coverage__);
        globalThis.__coverage__ ||= {};
        globalThis.__coverage__[filename] = combined.fileCoverageFor(filename).toJSON();
    }
    return { failed, result, primary, cleanup, owner, instances, events, printed, reports, context };
}

test.each(['browser-undefined', 'browser-null', 'client-null', 'phase-undefined', 'harness-null'])
('a rejected boundary value cannot become package success: %s', async mode => {
    const run = await exercise(mode);
    expect(run.failed).toBe(true);
    expect(isNativeError(run.result)).toBe(true);
    expect(run.result.message).toBe(mode.endsWith('undefined') ? 'undefined' : 'null');
    expect(run.instances).toHaveLength(0);
    expect(run.printed.some(line => line.startsWith('Live HTML package gate passed'))).toBe(false);
});

test.each(['partial-start', 'cards-render', 'cards-empty', 'close-sync', 'close-reject', 'close-many', 'smoke-runtime', 'smoke-render', 'smoke-markup', 'smoke-close'])
('all acquired servers are cleaned up when %s fails', async mode => {
    const run = await exercise(mode);
    expect(run.failed).toBe(true);
    expect(isNativeError(run.result)).toBe(true);
    expect(run.instances).toHaveLength(mode === 'partial-start' ? 2 : mode.startsWith('smoke') ? 6 : 5);
    expect(run.events).toEqual(run.instances.map((_instance, index) => 'close:' + index));
    if (mode.includes('close')) expect(isNativeError(run.owner.cleanupFailure)).toBe(true);
    if (['partial-start', 'cards-render', 'smoke-render'].includes(mode)) expect(run.result).toBe(run.primary);
    if (mode === 'close-many') expect(leaves(run.result)).toEqual([run.primary, run.cleanup]);
    else if (mode.includes('close')) expect(run.result).toBe(run.cleanup);
});

test.each(['pass', 'candidate'])('successful package coordination: %s', async mode => {
    const run = await exercise(mode);
    expect(run.failed).toBe(false);
    expect(run.instances).toHaveLength(6);
    expect(run.events).toEqual(['close:0', 'close:1', 'close:2', 'close:3', 'close:4', 'close:5']);
    expect(run.owner.cleanupFailure).toBeNull();
    expect(run.reports.map(report => report.status)).toEqual(['passed']);
    expect(run.printed.filter(line => line.startsWith('Live HTML package gate passed'))).toHaveLength(1);
    expect(run.printed.at(-1).includes('explicit local client candidate')).toBe(mode === 'candidate');
});

test.each([
    ['client-lock', 'Registry client must match'], ['client-bytes', 'differs from the locally tested'],
    ['runtime-bytes', 'Browser report measured a different client'],
    ...['manifest-bin', 'missing-bin', 'missing-preset'].map(mode => [mode, 'Packed initializer or TypeScript preset']),
    ...['ok', 'version', 'registrations', 'issues', 'code', 'message'].map(kind => ['doctor-' + kind, 'Packed doctor did not validate']),
    ...['counter', 'chatroom', 'cards', 'components', 'jsx'].map(kind => ['command-' + kind, 'Packed example commands']),
    ['cards-count', 'Packed card collection'], ['cards-metadata', 'Packed card collection'],
    ...['empty', 'count', 'metadata'].map(kind => ['components-' + kind, 'Packed reusable components']),
    ...['jsx', 'jsxs', 'jsxDEV'].map(mode => [mode, 'Packed JSX runtimes']),
    ['composition-id', 'Packed documentation composition'], ['composition-link', 'Packed documentation composition'],
    ['static-title', 'Packed static exporter'], ['static-live', 'Packed static exporter'],
])('the package rejects incorrect consumer evidence: %s', async (mode, message) => {
    const run = await exercise(mode);
    expect(run.failed).toBe(true);
    expect(run.result.message).toContain(message);
    expect(run.printed.some(line => line.startsWith('Live HTML package gate passed'))).toBe(false);
});

test.each(['browser-error', 'browser-and-client', 'phase-error', 'final-client'])
('original errors survive coordinator verification: %s', async mode => {
    const run = await exercise(mode);
    expect(run.failed).toBe(true);
    expect(leaves(run.result)).toEqual(mode === 'browser-and-client' ? [run.primary, run.cleanup] : [run.primary]);
    if (mode === 'phase-error') {
        expect(run.reports[0].status).toBe('failed');
        expect(run.result.reportDirectory).toContain(path.join('coverage', 'packed-browser'));
    }
    expect(run.printed.some(line => line.startsWith('Live HTML package gate passed'))).toBe(false);
});

test('workspace cleanup failure cannot follow a printed package success', async () => {
    const run = await exercise('workspace-cleanup');
    expect(run.failed).toBe(true);
    expect(run.result).toBe(run.cleanup);
    expect(run.printed.some(line => line.startsWith('Live HTML package gate passed'))).toBe(false);
});

test('the CLI rejects with a non-zero exit code and the original error', async () => {
    const run = await exercise('cli');
    expect(run.failed).toBe(true);
    expect(run.context.process.exitCode).toBe(1);
    expect(run.result).toBe(run.primary);
});
