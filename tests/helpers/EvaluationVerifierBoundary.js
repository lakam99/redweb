'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const filename = path.resolve(__dirname, '../../scripts/evaluation/verify.js');
const nativeRequire = createRequire(filename);
const { combineFailures } = nativeRequire('../verify-live-html-browser');

/** Explicit verifier unit double: synthetic browser/process boundaries, real owned files. */
class EvaluationVerifierBoundary {
    constructor(directory, { mode = 'working', cli = false, reportFile } = {}) {
        this.directory = directory;
        this.mode = mode;
        this.pages = []; this.browsers = []; this.stopped = []; this.removed = []; this.appStops = []; this.builds = [];
        this.time = 0;
        this.primary = new Error('unit primary failure');
        this.browserFailure = new Error('unit browser cleanup failure');
        this.profileFailure = new Error('unit profile cleanup failure');
        this.child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
        this.completed = new Promise(resolve => { this.finish = resolve; });
        const owner = this;
        const browser = {
            browserCandidates: [mode === 'no-browser' ? path.join(directory, 'missing-browser') : filename],
            launchBrowserWithRetry: async () => {
                const child = { id: this.browsers.length + 1 }; this.browsers.push(child);
                return { browser: { child }, endpoint: 'ws://127.0.0.1:9222' };
            },
            openPage: async () => this.page(),
            eventual: (expression, label) => ({ expression, label }),
            stopBrowser: async child => {
                this.stopped.push(child);
                if (mode === 'browser-cleanup') throw this.browserFailure;
            },
            removeTemporaryDirectory: async profile => {
                this.removed.push(profile);
                if (['profile-cleanup', 'combined-cleanup'].includes(mode)) throw this.profileFailure;
                fs.rmSync(profile, { recursive: true, force: true });
            },
            combineFailures,
        };
        const processes = {
            runBuild: async root => {
                this.builds.push(root);
                return mode === 'build-error' ? { exitCode: 0, error: 'unit build error' }
                    : { exitCode: mode === 'build-nonzero' ? 2 : 0 };
            },
            spawnManaged: () => {
                queueMicrotask(() => {
                    this.child.stderr.emit('data', 'unit startup diagnostic');
                    if (mode === 'startup-error') return this.child.emit('error', this.primary);
                    if (mode === 'startup-exit') return this.child.emit('exit', 3);
                    this.child.stdout.emit('data', 'startup log\nnull\n{"url":17}\n' + JSON.stringify({
                        url: mode === 'invalid-url' ? 'http://0.0.0.0:12345/' : 'http://127.0.0.1:12345/',
                    }) + '\n');
                });
                return this.child;
            },
            stopProcessTree: async child => {
                this.appStops.push(child);
                if (mode === 'app-cleanup') throw this.primary;
                child?.emit('exit', 0);
            },
            listenerAddresses: () => mode === 'empty-listeners' ? [] : mode === 'wildcard' ? ['0.0.0.0'] : ['127.0.0.1', '::1'],
        };
        this.context = {
            module: { exports: {} }, __dirname: path.dirname(filename), URL, AbortSignal, AggregateError,
            Date: class extends Date { static now() { return owner.time; } },
            setTimeout: callback => {
                this.time += 25;
                for (const page of this.pages) {
                    if (mode === 'delayed-handshake') page.emit('Network.webSocketHandshakeResponseReceived', { response: { status: 101 } });
                    if (mode === 'pending-data') page.emit('Network.loadingFinished', { requestId: 'pending' });
                }
                queueMicrotask(callback);
            },
            fetch: async () => {
                if (mode === 'combined-cleanup') throw this.primary;
                return { status: 200, headers: { get: () => 'text/html' } };
            },
            process: { env: { REDWEB_BROWSER: '' }, argv: ['node', filename, directory, ...(reportFile ? [reportFile] : [])] },
            console: { log: output => { this.output = output; this.finish(); } },
            require: name => name === '../verify-live-html-browser' ? browser : name === './process' ? processes
                : name === 'os' ? { tmpdir: () => directory } : nativeRequire(name),
        };
        if (cli) this.context.require.main = this.context.module;
        vm.runInNewContext(createInstrumenter().instrumentSync(fs.readFileSync(filename, 'utf8'), filename), this.context, { filename });
        this.api = this.context.module.exports;
    }

    page() {
        const socket = new EventEmitter();
        const page = { closed: 0, commands: [], socket, bobReads: 0 };
        socket.close = () => { page.closed += 1; };
        page.emit = (method, params = {}) => socket.emit('message', JSON.stringify({ method, params }));
        page.command = async (method, params = {}) => {
            page.commands.push({ method, params });
            if (method === 'Browser.getVersion') return { product: 'unit-double-not-a-browser' };
            if (method === 'Fetch.failRequest' && this.mode === 'interception-error') throw this.primary;
            if (method === 'Page.navigate') {
                socket.emit('message', '{}');
                page.emit('Network.requestWillBeSent', { type: 'Document', requestId: 'document' });
                page.emit('Network.requestWillBeSent', { type: 'Fetch', requestId: 'pending' });
                page.emit('Fetch.requestPaused', { requestId: 'before-ready' });
                if (!['pending-data', 'persistent-data'].includes(this.mode)) page.emit('Network.loadingFinished', { requestId: 'pending' });
                page.emit('Network.loadingFailed', { requestId: 'failed' });
                page.emit('Network.webSocketCreated');
                page.emit('Network.webSocketFrameSent');
                page.emit('Network.webSocketHandshakeResponseReceived', { response: { status: 200 } });
                if (!['no-handshake', 'delayed-handshake'].includes(this.mode)) page.emit('Network.webSocketHandshakeResponseReceived', { response: { status: 101 } });
                for (let i = 0; i < (this.mode === 'network-cap' ? 10010 : 1); i++) page.emit('Network.webSocketFrameReceived');
            }
            if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased') page.emit('Fetch.requestPaused', { requestId: 'after-ready' });
            return {};
        };
        page.evaluate = async expression => {
            // Opaque observation tokens deliberately do not implement a fake DOM.
            if (typeof expression !== 'string') return true;
            if (expression.includes('scrollIntoView')) return { x: 1, y: 2 };
            if (expression.endsWith('.value')) return 'unsent draft';
            if (expression.includes('Boolean(window.trialInjected)')) return false;
            if (expression.includes("includes('Bob')")) return this.mode === 'stale-presence' || page.bobReads++ === 0;
            return true;
        };
        this.pages.push(page);
        return page;
    }

    collect() {
        if (process.argv.includes('--collectCoverageFrom=scripts/evaluation/verify.js')) {
            const map = createCoverageMap(globalThis.__coverage__ || {}); map.merge(this.context.__coverage__);
            globalThis.__coverage__ ||= {}; globalThis.__coverage__[filename] = map.fileCoverageFor(filename).toJSON();
        }
    }
}

module.exports = { EvaluationVerifierBoundary };
