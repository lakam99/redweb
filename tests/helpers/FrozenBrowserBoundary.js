'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const filename = path.resolve(__dirname, '../../scripts/verify-live-html-browser.js');
const nativeRequire = createRequire(filename);
const source = fs.readFileSync(filename, 'utf8');
const instrumenter = createInstrumenter();
const compiled = instrumenter.instrumentSync(source, filename);
const expected = instrumenter.lastFileCoverage();

/** Explicit process/CDP/application unit boundaries; observations are NOT a DOM. */
class FrozenBrowserBoundary {
    constructor(directory, options = {}) {
        this.options = options; this.directory = directory;
        this.apps = []; this.children = []; this.sockets = []; this.logs = []; this.errors = [];
        this.requests = []; this.removals = []; this.timers = new Map(); this.time = 0;
        this.primary = new Error('unit primary failure');
        this.cleanup = Object.assign(new Error('unit profile cleanup failure'), { code: 'EACCES' });
        this.done = new Promise(resolve => { this.finish = resolve; });
        const owner = this;
        const template = () => 'unit markup, not rendered DOM';
        const jsx = tag => {
            if (tag === 'plaintext' && options.plaintext !== 'allow') {
                throw options.plaintext === 'wrong-error' ? this.primary : new TypeError('terminal element');
            }
            return template();
        };
        const api = {
            action: () => () => {}, component: () => () => {}, state: () => () => {}, page: () => () => {},
            html: template, attribute: String, url: String, codeBlock: template,
            each: (items, callback) => items.map(callback).join(''),
            start: (Page, { logger }) => {
                if (options.startFailure === this.apps.length) throw this.primary;
                logger.log(); logger.warn(); logger.error();
                const instance = new Page();
                if (instance.row) { instance.render(); instance.row.render(); instance.row.increment(); instance.option.render(); }
                const server = Object.assign(new EventEmitter(), {
                    listening: !options.delayedListening, address: () => ({ port: 12345 }),
                });
                const app = { server, stops: 0, manager: { active: new Map([[1, { page: instance }]]) },
                    shutdown: () => {
                        app.stops += 1;
                        if (options.shutdown === 'throw') throw this.cleanup;
                        return options.shutdown === 'reject' ? Promise.reject(this.cleanup) : Promise.resolve();
                    } };
                this.apps.push(app);
                if (options.delayedListening) queueMicrotask(() => server.emit('listening'));
                return app;
            },
        };
        const dependencies = {
            '..': api, '../jsx-runtime': { jsx, jsxs: jsx },
            '../src/htmx/HtmlRenderer': { render: template, document: template },
            '../examples/live-html/counter': { CounterPage: class {} },
            '../examples/live-html/chatroom': { createChatroomPage: () => class {} },
            '../examples/live-html/cards': { CardsPage: class {} },
            '../examples/live-html/components': { ComponentsPage: class {} },
            '../examples/live-html/jsx-page': { JsxPage: class {} },
            '../tests/fixtures/reactive-pages': { ReactivePage: class {} },
            '../tests/fixtures/action-page': { createActionPage: () => class {} },
            './lib/verify-action-feedback': { verifyActionFeedback: async () => {
                if (options.feedbackFailure) throw this.primary;
                if (options.falsyFailure) throw null;
            } },
            './lib/verify-dashboard-browser': { verifyDashboardBrowser: async () => {} },
            os: { tmpdir: () => directory },
            fs: { ...fs, existsSync: () => !options.noBrowser, rmSync: (...args) => {
                this.removals.push(args);
                if (options.remove) return options.remove(...args);
                if (options.profileFailure) throw this.cleanup;
                return fs.rmSync(...args);
            } },
            child_process: { spawn: (...args) => this.spawn(...args) },
            http: { request: (url, configuration, response) => this.request(url, configuration, response) },
            ws: class extends EventEmitter {
                constructor(url) {
                    super(); this.url = url; this.closed = 0; owner.sockets.push(this);
                    queueMicrotask(() => this.emit(options.socketError ? 'error' : 'open', owner.primary));
                }
                send(data) { owner.respond(this, JSON.parse(data)); }
                close() { this.closed += 1; if (options.closeFailure) throw owner.cleanup; }
            },
        };
        this.context = {
            module: { exports: {} }, __dirname: path.dirname(filename), Buffer, URL, AggregateError, TypeError,
            Date: class extends Date { static now() { return owner.time; } },
            setTimeout: (callback, milliseconds) => {
                const token = {}; this.timers.set(token, { callback, milliseconds }); return token;
            },
            clearTimeout: token => this.timers.delete(token),
            process: { platform: options.platform || 'win32', env: { REDWEB_BROWSER: options.candidates ? '' : 'unit-browser' } },
            console: { log: line => this.logs.push(line), error: error => { this.errors.push(error); this.finish(); } },
            require: name => Object.hasOwn(dependencies, name) ? dependencies[name] : nativeRequire(name),
        };
        if (options.cli) this.context.require.main = this.context.module;
        vm.runInNewContext(compiled, this.context, { filename });
        this.api = this.context.module.exports;
    }

    spawn(executable, args, settings) {
        const child = Object.assign(new EventEmitter(), {
            stderr: new EventEmitter(), exitCode: null, signalCode: null, kills: [], executable, args, settings,
        });
        child.kill = signal => {
            child.kills.push(signal);
            if (this.options.killFailure) throw this.cleanup;
            if (this.options.stubborn) return;
            const exit = () => { child.signalCode = signal || 'SIGTERM'; child.emit('exit', null); };
            if (this.options.asyncExit) queueMicrotask(exit); else exit();
        };
        const mode = this.options.launch?.[this.children.length] || 'working';
        this.children.push(child);
        queueMicrotask(() => {
            child.stderr.emit('data', 'unit startup diagnostic\n');
            if (mode === 'timeout') return;
            if (mode === 'error') return child.emit('error', this.primary);
            if (mode === 'exit') { child.exitCode = 3; return child.emit('exit', 3); }
            child.stderr.emit('data', 'DevTools listening on ws://127.0.0.1:9222/unit\n');
        });
        return child;
    }

    request(url, configuration, callback) {
        this.requests.push({ url, ...configuration });
        const request = new EventEmitter();
        request.end = () => queueMicrotask(() => {
            if (this.options.httpError) return request.emit('error', this.primary);
            const response = new EventEmitter(); callback(response);
            response.emit('data', Buffer.from(this.options.invalidJson ? '{' : '{"webSocketDebuggerUrl":"ws://unit"}'));
            response.emit('end');
        });
        return request;
    }

    respond(socket, request) {
        queueMicrotask(() => {
            let result = {};
            if (request.method === 'Runtime.evaluate') {
                const expression = request.params.expression;
                let value = true;
                if (expression.startsWith('getComputedStyle')) {
                    const colors = { "'output'": 'rgb(103, 232, 249)', "'.composer button'": 'rgb(34, 211, 238)',
                        "'.card'": 'rgb(31, 41, 55)', "'.counter-card'": 'rgb(17, 24, 39)' };
                    value = Object.entries(colors).find(([selector]) => expression.includes(selector))?.[1];
                }
                if (this.options.rejectObservation?.(expression)) value = false;
                result = this.options.evaluationError ? { exceptionDetails: { text: 'unit evaluation exception' } } : { result: { value } };
            }
            socket.emit('message', JSON.stringify({ id: request.id, ...(this.options.commandError
                ? { error: { message: 'unit command error' } } : { result }) }));
            if (request.method === 'Page.navigate') socket.emit('message', JSON.stringify({ method: 'Page.loadEventFired', params: {} }));
        });
    }

    tick() {
        const [token, timer] = this.timers.entries().next().value;
        this.timers.delete(token); this.time += timer.milliseconds; timer.callback();
    }

    collect() {
        assert.equal(fs.readFileSync(filename, 'utf8'), source, 'Frozen source changed');
        const measured = this.context.__coverage__[filename];
        for (const field of ['statementMap', 'fnMap', 'branchMap']) {
            assert.deepEqual(JSON.parse(JSON.stringify(measured[field])), JSON.parse(JSON.stringify(expected[field])));
        }
        if (process.argv.includes('--collectCoverageFrom=scripts/verify-live-html-browser.js')) {
            const map = createCoverageMap(globalThis.__coverage__ || {}); map.merge(this.context.__coverage__);
            globalThis.__coverage__ ||= {}; globalThis.__coverage__[filename] = map.fileCoverageFor(filename).toJSON();
        }
    }
}

module.exports = { FrozenBrowserBoundary };
