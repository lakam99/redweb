'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const filename = path.resolve(__dirname, '../../scripts/verify-recovery.js');
const nativeRequire = createRequire(filename);
const source = fs.readFileSync(filename, 'utf8');
const instrumenter = createInstrumenter();
const compiled = instrumenter.instrumentSync(source, filename);
const expected = instrumenter.lastFileCoverage();

/** Explicit application/clock/heap unit boundaries. No values are memory evidence. */
class OriginalRecoveryBoundary {
    constructor(directory, options = {}) {
        this.options = options; this.time = 0; this.gcs = 0; this.stops = 0;
        this.sent = []; this.replies = []; this.captures = []; this.stdout = ''; this.stderr = '';
        this.primary = options.primitiveFailure ? 'unit primitive failure' : new Error('unit recovery failure');
        this.done = new Promise(resolve => { this.finish = resolve; });
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
                    this.server = Object.assign(new EventEmitter(), {
                        listening: !options.delayedListening, address: () => ({ port: 12345 }),
                    });
                }
                async shutdown() { owner.stops++; owner.finish(); }
            },
        };
        const harness = {
            silentLogger: () => {},
            waitFor: async (_server, event) => { assert.equal(event, 'listening'); },
            openClient: async url => {
                assert.equal(url, 'ws://127.0.0.1:12345/reconnect');
                if (options.openFailure) throw this.primary;
                const socket = new EventEmitter(); this.route.clients.set(socket, socket);
                socket.send = text => {
                    const message = JSON.parse(text); this.sent.push(message);
                    if (options.messageFailure) return socket.emit('error', this.primary);
                    const handler = new this.route.settings.handlers[0]();
                    assert.equal(handler.type, message.type);
                    handler.onMessage({
                        joinRoom: name => this.route.rooms.set(name, true),
                        createSession: (id, value) => this.route.sessions.set(id, value),
                        sendJson: value => { this.replies.push(value); queueMicrotask(() => socket.emit('message', JSON.stringify(value))); },
                    }, message);
                };
                return socket;
            },
            closeClient: async socket => {
                if (!options.stuckClients && !options.delayedCleanup) this.route.clients.delete(socket);
                this.route.sessions.clear();
                if (!options.stuckRooms) this.route.rooms.clear();
            },
        };
        this.context = {
            Buffer, __dirname: path.dirname(filename),
            global: { gc: options.noGc ? undefined : () => { this.gcs++; } },
            Date: class extends Date { static now() { return owner.time; } },
            setImmediate: callback => queueMicrotask(callback),
            setTimeout: (callback, milliseconds) => {
                this.time += milliseconds;
                if (options.delayedCleanup) this.route.clients.clear();
                queueMicrotask(callback);
            },
            process: { pid: 123, env: options.environment || {},
                memoryUsage: () => ({ heapUsed: options.heaps?.[this.gcs / 2 - 1]
                    ?? (options.heapGrowth && this.gcs >= 4 ? 1200 : 1000) }),
                stdout: { write: text => { this.stdout += text; } },
                stderr: { write: text => { this.stderr += text; this.finish(); } },
            },
            require: name => name === '..' ? redweb : name === './realtime-harness' ? harness
                : name === 'node:v8' ? {
                    getHeapSpaceStatistics: () => [{ space_name: 'unit-not-native-heap' }],
                    getHeapCodeStatistics: () => ({ code_and_metadata_size: 1 }),
                    writeHeapSnapshot: target => {
                        assert.equal(path.dirname(target), directory);
                        this.captures.push(target);
                        fs.writeFileSync(target, 'unit boundary, not a V8 snapshot');
                    },
                } : nativeRequire(name),
        };
        try { vm.runInNewContext(compiled, this.context, { filename }); }
        catch (error) { this.initializationError = error; this.finish(); }
    }

    collect() {
        assert.equal(fs.readFileSync(filename, 'utf8'), source, 'Original recovery source changed');
        const measured = this.context.__coverage__[filename];
        for (const field of ['statementMap', 'fnMap', 'branchMap']) {
            assert.deepEqual(JSON.parse(JSON.stringify(measured[field])), JSON.parse(JSON.stringify(expected[field])));
        }
        if (process.argv.includes('--collectCoverageFrom=scripts/verify-recovery.js')) {
            const map = createCoverageMap(globalThis.__coverage__ || {}); map.merge(this.context.__coverage__);
            globalThis.__coverage__ ||= {}; globalThis.__coverage__[filename] = map.fileCoverageFor(filename).toJSON();
        }
    }
}

module.exports = { OriginalRecoveryBoundary };
