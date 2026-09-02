'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { SourceBoundary } = require('./SourceBoundary');
const source = new SourceBoundary('scripts/diagnostics/recovery-split.cjs');

/** Explicit process/IPC boundaries and real files confined to one owned workspace. */
class RecoveryCoordinatorBoundary {
    constructor(directory, options = {}) {
        this.directory = directory; this.options = options;
        this.children = []; this.requests = []; this.stops = []; this.timers = new Map();
        this.sent = 0; this.stdout = ''; this.stderr = ''; this.allocations = [];
        this.primary = new Error('Unit coordinator failure'); this.manifestReads = 0;
        const owner = this;
        const nativeFs = {
            ...fs,
            mkdirSync(target, settings) {
                if (target === path.resolve(path.dirname(source.filename), '../../coverage')) return;
                return fs.mkdirSync(target, settings);
            },
            mkdtempSync(prefix) {
                const privateHeap = path.basename(prefix).startsWith('redweb-private-client-heap-');
                const target = fs.mkdtempSync(path.join(directory, privateHeap ? 'private-' : 'report-'));
                owner.allocations.push(target);
                if (!privateHeap) {
                    owner.reportDirectory = target;
                    if (options.outputAcquisitionFailure) fs.writeFileSync(path.join(target, 'server.stdout.log'), 'existing');
                }
                return target;
            },
            readFileSync(target, encoding) {
                if (options.summaryFailure && String(target).endsWith('.log')) throw owner.primary;
                const bytes = fs.readFileSync(target, encoding);
                if (options.changedInput && target === path.resolve(path.dirname(source.filename), '../../package.json')
                    && ++owner.manifestReads > 1) return Buffer.concat([Buffer.from(bytes), Buffer.from(' ')]);
                return bytes;
            },
            appendFileSync(target, bytes) {
                if (options.sampleWriteFailure && String(target).endsWith('samples.ndjson')) throw 0;
                return fs.appendFileSync(target, bytes);
            },
            writeFileSync(target, bytes, settings) {
                if (options.reportWriteFailure && String(target).endsWith('report.json')) throw 0;
                return fs.writeFileSync(target, bytes, settings);
            },
        };
        const modules = {
            'node:fs': nativeFs,
            '../evaluation/process': {
                spawnManaged: (args, settings) => this.spawn(args, settings),
                stopProcessTree: async child => {
                    this.stops.push(child.role);
                    if (options.closeFailure === child.role || options.closeFailure === 'both') throw this.primary;
                    this.finish(child, options.signalExit ? null : 0, options.signalExit ? 'SIGTERM' : null);
                },
            },
            '../../tests/helpers/network': { withTimeout: async (promise, label) => {
                if (options.timeoutLabel === label) throw this.primary;
                return promise;
            } },
            './HeapCodeComparison.cjs': { compareFiles: (target, captures) => {
                assert(owner.allocations.includes(target)); assert.equal(captures.length, 2);
                if (options.comparisonFailure) throw new Error('Private unit data must not escape');
                return options.oversizedComparison ? { value: 'x'.repeat(1024 * 1024) } : { diagnosticOnly: true };
            } },
            './recovery-code-summary.cjs': { summarize: text => {
                assert.equal(typeof text, 'string');
                if (options.censusFailure) throw 0;
                return { diagnosticOnly: true };
            } },
        };
        const module = { exports: {} };
        const require = name => Object.hasOwn(modules, name) ? modules[name] : source.require(name);
        require.resolve = name => source.require.resolve(name);
        require.main = options.cli ? module : {};
        this.context = source.execute({
            Buffer, module, require, __dirname: path.dirname(source.filename),
            setTimeout: callback => { const token = {}; this.timers.set(token, callback); return token; },
            clearTimeout: token => this.timers.delete(token),
            process: { argv: ['node', source.filename, ...(options.args || [])], env: { NODE_OPTIONS: 'unit-must-not-inherit' },
                versions: { node: '22.21.0' }, platform: 'unit-platform', arch: 'unit-arch', pid: 123,
                stdout: { write: text => { this.stdout += text; } }, stderr: { write: text => { this.stderr += text; } } },
        });
        this.api = module.exports;
    }

    spawn(args, settings) {
        if (this.options.spawnFailureAt === this.children.length) throw 0;
        const role = args[args.indexOf(source.filename.replace('recovery-split.cjs', 'recovery-split-worker.cjs')) + 1];
        assert(['server', 'client'].includes(role));
        const child = Object.assign(new EventEmitter(), { role, pid: 100 + this.children.length,
            connected: true, exitCode: null, signalCode: null, args, settings, releases: [] });
        for (const stream of ['stdout', 'stderr']) {
            child[stream] = Object.assign(new EventEmitter(), { closed: false, destroy: () => {
                child.releases.push(stream);
                if (this.options.releaseFailures) throw new Error(`Unit ${stream} release failure`);
                child[stream].closed = true; child[stream].emit('close');
            } });
        }
        child.unref = () => { child.releases.push('unref'); if (this.options.releaseFailures) throw new Error('Unit unref failure'); };
        child.disconnect = () => {
            child.releases.push('disconnect');
            if (this.options.releaseFailures) throw new Error('Unit disconnect failure');
            child.connected = false;
            if (child.stopped && !this.options.hangExit) queueMicrotask(() => this.finish(child));
        };
        child.send = (message, callback) => {
            this.requests.push({ role, ...message });
            if (this.options.sendThrows) throw this.primary;
            if (this.options.callbackFailure) { callback(this.primary); return; }
            callback();
            queueMicrotask(() => this.reply(child, message));
        };
        this.children.push(child);
        return child;
    }

    reply(child, message) {
        const { options } = this;
        if (options.dropReplies) return;
        if (options.exitCommand === message.command) { this.finish(child); return; }
        if (options.errorCommand === message.command) { child.emit('error', this.primary); return; }
        if (options.rejectCommand === message.command) { child.emit('message', { error: 'Unit rejected command' }); return; }
        if (!child.logged) {
            child.logged = true;
            child.stdout.emit('data', Buffer.from(options.largeOutput ? 'x'.repeat(1024 * 1024 + 10) : 'unit stdout'));
            child.stderr.emit('data', Buffer.from('unit stderr'));
        }
        let result;
        switch (message.command) {
            case 'start': result = { url: 'ws://unit.invalid/reconnect' }; break;
            case 'batch':
                this.sent += message.count;
                result = { sent: this.sent - (options.badSent ? 1 : 0), received: this.sent - (options.badReply ? 1 : 0) }; break;
            case 'barrier': result = { received: this.sent - (options.badBarrier ? 1 : 0) }; break;
            case 'sample': result = { pid: child.pid, memory: { heapUsed: 1000 } }; break;
            case 'snapshot': result = { pid: child.pid + (options.badSnapshotPid ? 1 : 0), phase: message.phase }; break;
            case 'stop':
                child.stopped = true; result = { stopped: true };
                if (options.tamperOutput && child.role === 'client') fs.appendFileSync(path.join(this.reportDirectory, 'client.stdout.log'), 'tamper');
                break;
            default: result = { unitReply: true };
        }
        child.emit('message', { result });
    }

    finish(child, code = 0, signal = null) {
        if (child.exitCode !== null || child.signalCode !== null) return;
        child.exitCode = code; child.signalCode = signal;
        child.emit('exit', code, signal);
        for (const name of ['stdout', 'stderr']) { child[name].closed = true; child[name].emit('close'); }
    }

    fireTimers() { for (const callback of [...this.timers.values()]) callback(); }
    async completed() { await this.context.__boundaryCompletion; }
    report() { return JSON.parse(fs.readFileSync(path.join(this.reportDirectory, 'report.json'), 'utf8')); }
    collect() { source.collect(this.context); }
}

module.exports = { RecoveryCoordinatorBoundary };
