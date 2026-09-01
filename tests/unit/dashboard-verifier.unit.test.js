'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const filename = path.resolve(__dirname, '../../scripts/lib/verify-dashboard-browser.js');

// Explicit boundary-fault units, not substitutes for native browser acceptance.
test.each(['pass', 'setup', 'skip', 'credentials', 'provision', 'store-close', 'create', 'listen',
    'open', 'evaluate', 'false-ready', 'context', 'navigation', 'object-found', 'readiness-error',
    'timeout', 'close', 'terminate', 'shutdown', 'combined', 'unref', 'late', 'late-close', 'unsettled'])
('dashboard verification unit: %s', async mode => {
    const events = [], execution = { directory: path.resolve('unit-dashboard') };
    const primary = new Error('unit operation failed');
    const cleanup = new Error('unit cleanup failed');
    const release = new Error('unit handle release failed');
    let firstReadiness = true, clock = 0, resolveLate;
    const app = { server: { address: () => ({ port: 9000 }), unref() {
        events.push('unref'); if (mode === 'unref') throw release;
    } }, shutdown: async () => {
        events.push('shutdown');
        if (['shutdown', 'combined', 'unref'].includes(mode)) throw cleanup;
    } };
    const page = { command: async method => {
        if (method === 'Page.navigate') { events.push('navigate'); return; }
        expect(method).toBe('Page.close'); events.push('close');
        if (['close', 'late-close'].includes(mode)) throw cleanup;
    }, socket: { terminate() {
        events.push('terminate'); if (mode === 'terminate') throw cleanup;
    } }, evaluate: async expression => {
        if (['evaluate', 'combined', 'unref'].includes(mode)) throw primary;
        if (expression.startsWith('Boolean(') && firstReadiness) {
            firstReadiness = false;
            if (mode === 'readiness-error') throw primary;
            if (mode === 'context') throw new Error('Execution context disappeared');
            if (mode === 'navigation') throw new Error('Navigation pending');
            if (mode === 'object-found') throw new Error('Object was not found');
            if (['false-ready', 'timeout'].includes(mode)) return false;
        }
        if (expression === `document.cookie.includes('redweb_dashboard')`) return false;
        if (expression.startsWith("fetch('/')")) return 401;
        if (expression === `document.querySelector('.card-grid h2').textContent`) return 'Browser saved card';
        return true;
    } };
    const nativeRequire = createRequire(filename);
    const requireBoundary = name => {
        if (name === './verify-starter') return { verifyStarter: async (_root, owner, template) => {
            expect(owner).toBe(execution); expect(template).toBe('dashboard');
            if (mode === 'setup') throw primary;
            return mode === 'skip' ? '# SKIP dashboard' : '# pass 1';
        } };
        if (name === './VerificationWorkspace') return { VerificationWorkspace: class {
            run(operation) { return operation(execution); }
        } };
        if (name === path.join(execution.directory, 'dashboard/dist/app')) return { createApp: () => {
            if (mode === 'create') throw primary; events.push('created'); return app;
        } };
        if (name === path.join(execution.directory, 'dashboard/dist/store')) return { DashboardStore: class {
            provision() { events.push('provision'); if (mode === 'provision') throw primary; }
            close() { events.push('store-close'); if (mode === 'store-close') throw primary; }
        } };
        if (name === path.join(execution.directory, 'dashboard/dist/auth')) return { credentials: async () => {
            if (mode === 'credentials') throw primary; return 'unit credentials';
        } };
        if (name === '../../tests/helpers/network') return {
            waitForListening: async () => { if (mode === 'listen') throw primary; },
            withTimeout: (promise, label) => {
                if (['late', 'late-close', 'unsettled'].includes(mode) && label === 'dashboard page open') {
                    promise.catch(() => {}); return Promise.reject(primary);
                }
                if (label === 'dashboard pending page open' && resolveLate) {
                    if (mode === 'unsettled') { promise.catch(() => {}); return Promise.reject(cleanup); }
                    resolveLate(page);
                }
                return promise;
            },
        };
        return nativeRequire(name);
    };
    const context = { require: requireBoundary, module: { exports: {} }, __dirname: path.dirname(filename),
        console: { log() {} }, setTimeout: callback => queueMicrotask(callback),
        Date: { now: () => mode === 'timeout' ? clock++ * 4001 : 0 } };
    vm.runInNewContext(createInstrumenter().instrumentSync(fs.readFileSync(filename, 'utf8'), filename), context, { filename });
    const result = await context.module.exports.verifyDashboardBrowser({ debugPort: 9222, openPage: async () => {
        if (mode === 'open') throw primary;
        if (['late', 'late-close', 'unsettled'].includes(mode)) return new Promise(resolve => { resolveLate = resolve; });
        return page;
    } }).catch(error => error);
    if (mode === 'unsettled') { resolveLate(page); await new Promise(resolve => setImmediate(resolve)); }
    const passing = ['pass', 'false-ready', 'context', 'navigation', 'object-found', 'close', 'terminate', 'shutdown'];
    if (passing.includes(mode)) expect(result).toBeUndefined();
    else if (mode === 'skip') expect(result.message).toMatch(/SKIP/);
    else if (mode === 'timeout') expect(result.message).toMatch(/Dashboard browser condition failed/);
    else expect(result).toBe(primary);
    if (events.includes('created')) expect(events).toContain('shutdown');
    if (mode === 'pass') expect(events).toContain('navigate');
    if (['credentials', 'provision'].includes(mode)) expect(events).toContain('store-close');
    if (events.includes('close')) expect(events).toContain('terminate');
    if (['close', 'terminate', 'shutdown', 'combined', 'unref', 'late-close', 'unsettled'].includes(mode)) {
        expect(execution.cleanupFailure).toBeDefined();
        if (mode === 'unref') expect(execution.cleanupFailure.errors).toEqual([cleanup, release]);
    } else expect(execution.cleanupFailure).toBeUndefined();
    if (['late', 'late-close', 'unsettled'].includes(mode)) expect(events).toContain('close');
    if (process.argv.includes('--collectCoverageFrom=scripts/lib/verify-dashboard-browser.js')) {
        const combined = createCoverageMap(globalThis.__coverage__ || {});
        combined.merge(context.__coverage__);
        globalThis.__coverage__ ||= {};
        globalThis.__coverage__[filename] = combined.fileCoverageFor(filename).toJSON();
    }
});
