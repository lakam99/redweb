'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const { verificationError } = require('../../scripts/lib/verificationError');
const filename = path.resolve(__dirname, '../../scripts/lib/example-dependency-probe.cjs');
const source = fs.readFileSync(filename, 'utf8');

// Explicit coordinator units evaluate the unchanged copied entrypoint. Only its
// dependency boundaries are replaced here; the installed-consumer IT replaces none.
test.each(['core', 'chat', 'listening', 'listen-error', 'fetch-error', 'action-error', 'close-error',
    'shutdown-error', 'combined-error', 'start-error', 'preflight-error', 'socket-error'])
('packed probe coordinator unit: %s', async mode => {
    const events = [], printed = [], errors = [];
    const chat = !['core', 'listening', 'listen-error', 'fetch-error', 'preflight-error'].includes(mode);
    const primary = new Error('unit primary probe failure');
    const packagePath = path.resolve('unit-installed/redweb/package.json');
    const config = { socketPath: '/live', pageId: 'unit-secret-page', version: 'unit' };
    const html = chat ? `Join the chatroom <script id="__redweb_page">${JSON.stringify(config)}</script> development.js?revision=unit-revision` : 'Server-side counter';
    const snapshot = { schemaVersion: 1, pages: { available: true, connections: { connected: 1 },
        registrations: { items: Object.freeze([{ instances: { items: [{ components: { items: [{ actions: { items: ['join'] } }] } }] } }]) } },
    sockets: { available: true } };
    const app = { server: { listening: mode === 'listening', address: () => ({ port: 1234 }) },
        inspect: () => chat ? snapshot : null,
        shutdown: async () => { events.push('shutdown'); if (['shutdown-error', 'combined-error'].includes(mode)) throw new Error('unit shutdown failure'); } };
    class Socket {
        constructor(url, options) {
            events.push('socket');
            expect(url).toBe('ws://127.0.0.1:1234/live?pageId=unit-secret-page&redwebVersion=unit');
            expect(options).toEqual({ handshakeTimeout: 5000, headers: { Origin: 'http://127.0.0.1:1234' } });
            if (mode === 'socket-error') throw primary;
        }
    }
    const missing = () => { const error = new Error('unit missing dependency'); error.code = 'MODULE_NOT_FOUND'; throw error; };
    const resolve = id => {
        if (id === 'redweb/package.json') return packagePath;
        if (id === 'redweb-client/live-html') return path.resolve('unit-client/live-html.cjs');
        if (id === 'typescript' && mode === 'preflight-error') return 'unexpected typescript';
        return missing();
    };
    const installedRequire = Object.assign(id => { expect(id).toBe('ws'); return Socket; }, { resolve });
    const dependencies = {
        redweb: { start: (_Page, options) => {
            events.push('start'); expect(options.port).toBe(0); expect(options.bind).toBe('127.0.0.1');
            expect(Boolean(options.development)).toBe(chat);
            if (mode === 'start-error') throw primary; return app;
        } },
        'node:module': { createRequire: requested => { expect(requested).toBe(packagePath); return installedRequire; } },
        'node:fs': { readFileSync: () => 'unit-client-bundle' },
        './probe-support/realtime-harness': { WebSocket: Socket,
            waitFor: async (_target, event) => { events.push(event); if (mode === 'listen-error') throw primary; },
            closeClient: async socket => { events.push('close');
                expect(Boolean(socket)).toBe(chat && !['start-error', 'socket-error'].includes(mode));
                if (['close-error', 'combined-error'].includes(mode)) throw new Error('unit close failure'); } },
        './probe-support/network': { withTimeout: (promise, label, ms) => {
            expect(label).toBe('packed example shutdown'); expect(ms).toBe(10000); return promise;
        } },
        './probe-support/lib/verificationError': { verificationError },
        './probe-support/lib/performProbeAction': { performProbeAction: async (_socket, version) => {
            events.push('action'); expect(version).toBe('unit');
            if (['action-error', 'combined-error'].includes(mode)) throw primary;
        } },
    };
    const requireBoundary = Object.assign(id => {
        if (id.endsWith('chatroom.js')) { if (!chat) return missing(); return { createChatroomPage: () => class {} }; }
        if (id.endsWith('counter.js')) return { CounterPage: class {} };
        if (Object.hasOwn(dependencies, id)) return dependencies[id];
        return require(id);
    }, { resolve });
    const sandbox = { require: requireBoundary, process: { argv: ['node', filename, chat ? 'chat' : 'core'], exitCode: 0 },
        console: { log: value => { events.push('success'); printed.push(value); }, error: value => errors.push(value) },
        AbortSignal, AggregateError, Error, JSON, encodeURIComponent,
        fetch: async (url, options) => {
            expect(options.signal).toBeInstanceOf(AbortSignal);
            if (mode === 'fetch-error') throw primary;
            const pathname = new URL(url).pathname;
            const data = pathname === '/' ? html : pathname.endsWith('runtime.js')
                ? 'import { mountLivePage } from "/__redweb/client.js";\nmountLivePage();\n'
                : pathname.endsWith('client.js') ? 'unit-client-bundle' : 'unit-development-asset';
            return { status: !chat && pathname.endsWith('/development') ? 404 : 200,
                headers: { get: key => key === 'cache-control' ? 'private, no-store' : pathname.endsWith('.css') ? 'text/css' : 'text/javascript' },
                text: async () => { events.push(`body:${pathname}`); return data; },
                json: async () => ({ revision: 'unit-revision' }) };
        } };
    // Original-source Istanbul counts include authored arrow functions; no V8
    // anonymous-function filtering or source rewrites are used for this scope.
    sandbox.__coverage__ = {};
    const code = createInstrumenter({ coverageGlobalScope: 'globalThis', coverageGlobalScopeFunc: false }).instrumentSync(source, filename);
    vm.runInNewContext(code, sandbox, { filename });
    for (let index = 0; index < 100 && !printed.length && !errors.length; index++) await Promise.resolve();
    const success = ['core', 'chat', 'listening'].includes(mode);
    expect(sandbox.process.exitCode).toBe(success ? 0 : 1);
    expect(printed).toHaveLength(success ? 1 : 0); expect(errors).toHaveLength(success ? 0 : 1);
    if (success) {
        expect(events.slice(-3)).toEqual(['close', 'shutdown', 'success']);
        expect(printed[0]).toContain(chat ? 'Packed chat' : 'Core and counter');
        if (!chat) expect(events).toContain('body:/__redweb/development');
    } else if (!['start-error', 'preflight-error'].includes(mode)) {
        expect(events.slice(-2)).toEqual(['close', 'shutdown']);
        expect(errors[0].errors).toHaveLength(mode === 'combined-error' ? 3 : 1);
        if (mode === 'combined-error') expect(errors[0].errors.map(error => error.message))
            .toEqual(['unit primary probe failure', 'unit close failure', 'unit shutdown failure']);
    } else expect(events).not.toContain('shutdown');
    expect(Object.keys(sandbox.__coverage__)).toEqual([filename]);
    expect(sandbox.__coverage__[filename].path).toBe(filename);
    // The maintained scoped command explicitly opts into this private source.
    // Ordinary npm test must retain its declared library-only denominator.
    if (process.argv.includes('--collectCoverageFrom=scripts/lib/example-dependency-probe.cjs')) {
        globalThis.__coverage__ ||= {};
        const collected = createCoverageMap(globalThis.__coverage__);
        collected.merge(sandbox.__coverage__);
        globalThis.__coverage__[filename] = collected.fileCoverageFor(filename).toJSON();
    }
});
