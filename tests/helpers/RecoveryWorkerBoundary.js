'use strict';

const assert = require('node:assert/strict');
const { SourceBoundary } = require('./SourceBoundary');
const source = new SourceBoundary('scripts/diagnostics/recovery-split-worker.cjs');

/** Synthetic transport/process/clock/GC observations; never memory evidence. */
class RecoveryWorkerBoundary {
    constructor(options = {}) {
        this.options = options;
        this.time = 0; this.gcs = 0; this.stops = 0;
        this.sockets = []; this.messages = []; this.replies = []; this.stdout = '';
        this.exits = []; this.captures = []; this.handlers = new Map();
        this.primary = new Error('Unit worker failure');
        const owner = this;
        const redweb = {
            BaseHandler: class { constructor(type) { this.type = type; } },
            SocketRoute: class {
                constructor(settings) {
                    this.settings = settings;
                    this.clients = new Map(); this.rooms = new Map(); this.sessions = new Map();
                }
            },
            SocketServer: class {
                constructor(settings) {
                    owner.serverSettings = settings;
                    owner.route = new settings.routes[0]();
                    this.routes = [owner.route];
                    this.server = { listening: options.listening !== false, address: () => ({ port: 12345 }) };
                }
                async shutdown() { owner.stops++; if (options.stopError) throw owner.primary; }
            },
        };
        const harness = {
            silentLogger: () => {},
            WebSocket: class {
                constructor(url) {
                    assert.equal(url, 'ws://unit.invalid/reconnect');
                    this.index = owner.sockets.length; this.readyState = 0;
                    owner.sockets.push(this);
                }
                send(text) {
                    const message = JSON.parse(text); owner.messages.push(message);
                    if (options.failReplyAt === this.index) this.reject(owner.primary);
                    else this.resolve([Buffer.from(options.malformedReply ? '{' : JSON.stringify({ ready: message.id + (options.wrongReply ? 1 : 0) }))]);
                }
            },
            waitFor: async (target, event) => {
                if (event === 'listening') return;
                if (event === 'open') {
                    if (target.index === 1 && options.openGate) await options.openGate;
                    if (options.failOpenAt === target.index) throw owner.primary;
                    target.readyState = 1; return;
                }
                assert.equal(event, 'message');
                return new Promise((resolve, reject) => { target.resolve = resolve; target.reject = reject; });
            },
            closeClient: async socket => {
                socket.closeCalls = (socket.closeCalls || 0) + 1;
                if (options.failCloseAt === socket.index) throw owner.primary;
                if (!options.incompleteClose) socket.readyState = 3;
            },
        };
        this.context = source.execute({
            Buffer,
            require: name => name === '../..' ? redweb : name === '../realtime-harness' ? harness
                : name === './ClientHeapCapture.cjs' ? { ClientHeapCapture: class {
                    constructor(directory) { owner.captureDirectory = directory; }
                    capture(phase) {
                        if (options.snapshotError) throw new Error('Private unit snapshot details');
                        owner.captures.push(phase); return { phase, pid: 123 };
                    }
                } } : name === 'node:v8' ? {
                    getHeapSpaceStatistics: () => [{ space_name: 'unit-only' }],
                    getHeapCodeStatistics: () => ({ bytecode_and_metadata_size: 50 }),
                } : source.require(name),
            Date: class extends Date { static now() { return owner.time; } },
            setTimeout: (callback, milliseconds) => {
                owner.time += milliseconds;
                if (owner.route && milliseconds === 10 && options.barrierCleanupAfter !== undefined
                    && owner.time >= options.barrierCleanupAfter) owner.route.clients.clear();
                if (owner.route && milliseconds === 400 && !options.stuckRegistry) {
                    for (const name of ['clients', 'rooms', 'sessions']) owner.route[name].clear();
                }
                queueMicrotask(callback);
            },
            setImmediate: callback => queueMicrotask(callback),
            global: { gc: () => {
                owner.gcs++;
                if (Object.hasOwn(options, 'gcError')) throw options.gcError;
            } },
            process: {
                argv: ['node', source.filename, options.role || 'client', ...(options.heapDirectory ? [options.heapDirectory] : [])],
                execArgv: options.flags || [], pid: 123, version: 'unit-node', versions: { v8: 'unit-v8' },
                on: (event, handler) => owner.handlers.set(event, handler),
                send: reply => owner.replies.push(reply), exit: code => owner.exits.push(code),
                stdout: { write: text => { owner.stdout += text; } },
                memoryUsage: () => ({ heapUsed: 1000 }),
            },
        });
    }

    async request(command, data = {}) {
        const start = this.replies.length;
        await this.handlers.get('message')({ command, ...data });
        assert.equal(this.replies.length, start + 1);
        return this.replies[start];
    }

    deliver(id) {
        const handler = new this.route.settings.handlers[0]();
        assert.equal(handler.type, 'connect');
        this.route.clients.set(id, true);
        handler.onMessage({
            joinRoom: name => this.route.rooms.set(name, true),
            createSession: (key, value) => this.route.sessions.set(key, value),
            sendJson: reply => this.messages.push(reply),
        }, { id });
    }

    disconnect() { this.handlers.get('disconnect')(); }
    collect() { source.collect(this.context); }
}

module.exports = { RecoveryWorkerBoundary };
