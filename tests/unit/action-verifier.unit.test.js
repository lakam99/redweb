'use strict';

const path = require('node:path');
const compiled = path.resolve(__dirname, '../fixtures/unit-action-compiled.cjs');
const packageRoot = path.resolve(__dirname, '../fixtures/unit-action-package');

// Explicit coordinator fault boundaries, separate from native/compiled integration.
test.each(['pass', 'listening', 'listen-error', 'http-error', 'http-status', 'json', 'missing-config',
    'construct-error', 'connect-error', 'connect-timeout', 'request-error', 'client-error', 'dispose-error',
    'socket-close-error', 'shutdown-error', 'shutdown-timeout', 'revoke-timeout', 'wrong-revocation',
    'upgrade-error', 'combined', 'compile-error', 'start-error'])('action verifier unit: %s', async mode => {
    const events = [], compiles = [], owners = [];
    const primary = new Error('unit action primary');
    let clientError;
    const fault = code => Object.assign(new Error(code), { code });
    const pending = () => new Promise(() => {});
    class Socket { constructor(_url, options) {
        expect(options.handshakeTimeout).toBe(5000); events.push('socket');
    } }
    class Client {
        constructor(_url, options) {
            if (mode === 'construct-error') throw primary;
            this.options = options; this.total = 0;
            expect(options.reconnect).toEqual({ enabled: false });
            expect(options.requestTimeoutMs).toBe(5000);
        }
        onError(listener) { clientError = listener; }
        connect() {
            this.options.webSocketFactory('ws://unit');
            if (mode === 'client-error') clientError('unit malformed event');
            if (mode === 'connect-timeout') return pending();
            if (['connect-error', 'combined'].includes(mode)) throw primary;
            return Promise.resolve();
        }
        async request(type, { name, args }) {
            expect(type).toBe('redweb:html');
            if (mode === 'request-error') throw primary;
            if (args.length > 1) throw fault('ACTION_INVALID_INPUT');
            if (name === 'who') return { payload: { principal: 'trusted-owner', path: '/' } };
            const amount = Number(args[0].amount);
            if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000) throw fault('ACTION_INVALID_INPUT');
            if (amount === 11) throw fault('ACCESS_DENIED');
            this.total += amount;
            return { payload: { total: this.total, principal: 'trusted-owner' } };
        }
        dispose() { events.push('dispose'); if (['dispose-error', 'combined'].includes(mode)) throw new Error('unit dispose failed'); }
    }
    const app = {
        server: { listening: mode === 'listening', address: () => ({ port: 1 }) },
        revoke: async principal => {
            expect(principal).toBe('trusted-owner');
            if (mode === 'revoke-timeout') return pending();
            return mode === 'wrong-revocation' ? 0 : 1;
        },
        shutdown: async () => {
            events.push('shutdown');
            if (mode === 'shutdown-timeout') return pending();
            if (['shutdown-error', 'combined'].includes(mode)) throw new Error('unit shutdown failed');
        },
    };
    const originalFetch = global.fetch;
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    global.fetch = async () => {
        if (mode === 'http-error') throw primary;
        return { status: mode === 'http-status' ? 503 : 200, text: async () => mode === 'missing-config' ? 'no config' :
            `<script id="__redweb_page">${mode === 'json' ? '{' : JSON.stringify({ socketPath: '/live', pageId: 'unit', version: '1' })}</script>` };
    };
    const mocked = ['ws', 'redweb-client', '../../scripts/lib/compile-consumer', '../../scripts/realtime-harness',
        '../helpers/network', compiled, packageRoot];
    try {
        let verifyActionInput;
        jest.isolateModules(() => {
            jest.doMock('ws', () => Socket);
            jest.doMock('redweb-client', () => ({ RedwebClient: Client }));
            jest.doMock('../../scripts/lib/compile-consumer', () => ({ compileConsumer: async (_root, execution, _target, _source, options) => {
                owners.push(execution); compiles.push(options.experimentalDecorators);
                if (mode === 'compile-error') throw primary;
                return compiled;
            } }));
            jest.doMock(compiled, () => ({ ValidatedPage: class {} }), { virtual: true });
            jest.doMock(packageRoot, () => ({ start: (_Page, options) => {
                expect(options.authenticate()).toBe('trusted-owner');
                if (mode === 'start-error') throw primary;
                return app;
            } }), { virtual: true });
            jest.doMock('../../scripts/realtime-harness', () => ({
                waitFor: async (_server, event) => { expect(event).toBe('listening'); if (mode === 'listen-error') throw primary; },
                closeClient: async () => { events.push('socket-close'); if (['socket-close-error', 'combined'].includes(mode)) throw new Error('unit socket close failed'); },
            }));
            jest.doMock('../helpers/network', () => ({ ...jest.requireActual('../helpers/network'), websocketUpgradeStatus: async () => {
                if (mode === 'upgrade-error') throw primary; return 401;
            } }));
            ({ verifyActionInput } = require('../../scripts/lib/verify-action-input'));
        });
        const execution = { directory: path.resolve('unit-action-workspace'), cleanupFailure: null };
        let failure;
        const task = verifyActionInput(packageRoot, execution).catch(error => { failure = error; });
        await jest.runAllTimersAsync(); await task;
        if (['pass', 'listening'].includes(mode)) {
            expect(failure).toBeUndefined(); expect(compiles).toEqual([false, true]);
            expect(events.filter(event => event === 'shutdown')).toHaveLength(2);
        } else {
            expect(failure).toBeInstanceOf(Error); expect(compiles).toEqual([false]);
            if (!['compile-error', 'start-error'].includes(mode)) expect(events.slice(-2)).toEqual(['socket-close', 'shutdown']);
            const cleanupFailed = ['dispose-error', 'socket-close-error', 'shutdown-error', 'shutdown-timeout', 'combined'].includes(mode);
            expect(execution.cleanupFailure).toBe(cleanupFailed ? failure : null);
            if (mode === 'combined') expect(failure.errors.map(error => error.message)).toEqual([
                expect.stringContaining('unit action primary'), 'unit dispose failed', 'unit socket close failed', 'unit shutdown failed',
            ]);
        }
        expect(jest.getTimerCount()).toBe(0); expect(owners.every(owner => owner === execution)).toBe(true);
    } finally {
        global.fetch = originalFetch; jest.useRealTimers();
        mocked.forEach(name => jest.dontMock(name)); jest.resetModules();
    }
});
