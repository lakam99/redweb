'use strict';

// Explicit report-boundary units; the separate integration invokes the entire
// unchanged browser workload with actual Chromium and HTTP peers.
jest.mock('../../scripts/lib/verify-refresh-controls', () => ({
    RevisionPeer: class { constructor(script) { this.script = script; } },
    verifyRefreshControls: jest.fn(),
    headingReady: jest.requireActual('../../scripts/lib/verify-refresh-controls').headingReady,
}));

const { verifyRefreshControls } = require('../../scripts/lib/verify-refresh-controls');
const { verifyRefreshCoverage } = require('../../scripts/lib/verify-refresh-coverage');
const { isNativeError } = require('node:util/types');
const leaves = error => Array.isArray(error?.errors) ? error.errors.flatMap(leaves) : [error];
const source = { source: 'poll();poll();', instrumented: 'poll();poll();' };

test('history observations retain false and true without changing behavioral parity', async () => {
    const run = {};
    for (const instrumented of [false, true]) {
        verifyRefreshControls.mockResolvedValueOnce({ bfcacheRestored: instrumented });
        await verifyRefreshCoverage({ coverage: { source: 'poll();poll();', instrumented: 'poll();poll();' },
            instrumented, run, onPeer() {} });
    }
    expect(run.historyRestoration).toEqual({ plain: { bfcacheRestored: false }, instrumented: { bfcacheRestored: true } });
    expect(run.plainCases).toEqual(run.instrumentedCases);
});

test('failed controls cannot produce a successful history observation', async () => {
    const failure = new Error('unit control failure');
    verifyRefreshControls.mockRejectedValueOnce(failure);
    const run = {};
    await expect(verifyRefreshCoverage({ coverage: { source: 'poll();poll();' }, instrumented: false, run, onPeer() {} }))
        .rejects.toBe(failure);
    expect(run).toEqual({});
});

test.each([undefined, null, false, 0, ''])('a rejected controls value is never a successful report: %p', async failure => {
    verifyRefreshControls.mockRejectedValueOnce(failure);
    const run = {};
    let rejected = false;
    const error = await verifyRefreshCoverage({ coverage: source, instrumented: false, run, onPeer() {} })
        .catch(error => { rejected = true; return error; });
    expect(rejected).toBe(true);
    expect(isNativeError(error)).toBe(true);
    expect(error.cause).toBe(failure);
    expect(run).toEqual({});
});

test('collection, page close and socket release failures all survive cleanup', async () => {
    const failures = [new Error('collect'), new Error('close'), new Error('release')];
    verifyRefreshControls.mockImplementationOnce(async (_port, _directory, { closePage }) => closePage({
        evaluate: async () => { throw failures[0]; }, command: async () => { throw failures[1]; },
        socket: { terminate() { throw failures[2]; } },
    }));
    const error = await verifyRefreshCoverage({ coverage: source, instrumented: true, run: {}, onPeer() {} }).catch(error => error);
    expect(leaves(error)).toEqual(failures);
});

test.each(['collect', 'close', 'release'].flatMap(phase => [undefined, null, false, 0, ''].map(value => [phase, value])))
('a falsy %s failure cannot disappear: %p', async (phase, primary) => {
    let released = false;
    verifyRefreshControls.mockImplementationOnce(async (_port, _directory, { closePage }) => closePage({
        evaluate: async () => { if (phase === 'collect') throw primary; },
        command: async () => { if (phase === 'close') throw primary; },
        socket: { terminate() { released = true; if (phase === 'release') throw primary; } },
    }));
    let rejected = false;
    const error = await verifyRefreshCoverage({ coverage: source, instrumented: true, run: {}, onPeer() {} })
        .catch(error => { rejected = true; return error; });
    expect(released).toBe(true);
    expect(rejected).toBe(true);
    expect(isNativeError(error)).toBe(true);
    expect(error.cause).toBe(primary);
});

test.each([false, true])('upload failure is preserved when controls also fail: %p', rejectControls => {
    const upload = new Error('original upload failure');
    const timeout = new Error('pagehide delivery timed out');
    verifyRefreshControls.mockImplementationOnce(async (_port, _directory, { peer }) => {
        peer.failures.push(upload);
        if (rejectControls) throw timeout;
        return { bfcacheRestored: false };
    });
    return verifyRefreshCoverage({ coverage: source, instrumented: false, run: {}, onPeer() {} })
        .then(() => { throw new Error('Expected upload rejection'); }, error => {
            expect(leaves(error)).toEqual(rejectControls ? [timeout, upload] : [upload]);
        });
});

test.each([undefined, null, false, 0, ''])('a falsy supplemental-page failure stops subsequent checks: %p', async primary => {
    let visits = 0, releases = 0;
    verifyRefreshControls.mockImplementationOnce(async (_port, _directory, { afterChecks }) => afterChecks());
    const error = await verifyRefreshCoverage({ coverage: source, instrumented: false, run: {}, onPeer() {},
        visit: async () => {
            if (++visits > 1) throw new Error('A second page must not be visited');
            return { evaluate: async () => { throw primary; }, command: async () => ({}),
                socket: { terminate() { releases++; } } };
        },
    }).catch(error => error);
    expect(visits).toBe(1);
    expect(releases).toBe(1);
    expect(isNativeError(error)).toBe(true);
    expect(error.cause).toBe(primary);
});

test('pagehide navigation failure still closes the page and releases its socket', async () => {
    const primary = new Error('navigation failed');
    const events = [];
    verifyRefreshControls.mockImplementationOnce(async (_port, _directory, { closePage }) => closePage({
        evaluate: async () => ({}), command: async method => {
            events.push(method); if (method === 'Page.navigate') throw primary;
        }, socket: { terminate() { events.push('release'); } },
    }));
    await expect(verifyRefreshCoverage({ coverage: { ...source, collect() {} }, instrumented: true, run: {}, onPeer() {} }))
        .rejects.toBe(primary);
    expect(events).toEqual(['Page.navigate', 'Page.close', 'release']);
});

test('an expired polling deadline rejects and still releases the supplemental page', async () => {
    let clock = 0, releases = 0;
    const now = jest.spyOn(Date, 'now').mockImplementation(() => (clock += 10001));
    verifyRefreshControls.mockImplementationOnce(async (_port, _directory, { afterChecks }) => afterChecks());
    try {
        await expect(verifyRefreshCoverage({ coverage: source, instrumented: false, run: {}, onPeer() {},
            visit: async () => ({ command: async () => ({}), socket: { terminate() { releases++; } } }),
        })).rejects.toThrow('Timed out: heading readiness fixture');
        expect(releases).toBe(1);
    } finally { now.mockRestore(); }
});

test('a supplemental operation and its cleanup both remain visible', async () => {
    const primary = new Error('operation'), cleanup = new Error('close');
    verifyRefreshControls.mockImplementationOnce(async (_port, _directory, { afterChecks }) => afterChecks());
    const result = await verifyRefreshCoverage({ coverage: source, instrumented: false, run: {}, onPeer() {},
        visit: async () => ({ evaluate: async () => { throw primary; }, command: async method => {
            if (method === 'Page.close') throw cleanup; return {};
        }, socket: { terminate() {} } }),
    }).catch(error => error);
    expect(leaves(result)).toEqual([primary, cleanup]);
});

test('an upload end after an earlier stream error cannot be counted as a valid report', () => {
    const { EventEmitter } = require('node:events');
    const { CoverageRevisionPeer } = require('../../scripts/lib/verify-refresh-coverage');
    let collected = 0, ended = 0;
    const peer = new CoverageRevisionPeer({ ...source, collect() { collected++; } }, false);
    const request = new EventEmitter();
    request.url = '/__coverage';
    peer.respond(request, { end() { ended++; } });
    const primary = new Error('stream failed');
    request.emit('error', primary);
    request.emit('end');
    expect(peer.failures).toEqual([primary]);
    expect([collected, ended, peer.reports]).toEqual([0, 0, 0]);
});

test.each(['window.original === undefined', 'document.getElementById("draft").value === ""'])
('a reload transition retries a rejected evaluation: %s', async transition => {
    let peer, visits = 0, attempts = 0, releases = 0;
    verifyRefreshControls.mockImplementationOnce(async (_port, _directory, { afterChecks }) => afterChecks());
    const result = await verifyRefreshCoverage({ coverage: source, instrumented: false, run: {}, onPeer(value) {
        peer = value; peer.url = 'http://unit.invalid'; let calls = 0;
        Object.defineProperty(peer, 'calls', { get: () => ++calls });
    },
        visit: async () => {
            const page = ++visits;
            let heading = null;
            return { command: async (method, params) => {
                if (method === 'Page.navigate') heading = params.url.endsWith('/away') ? 'Away' : 'Revision fixture';
                return method === 'Runtime.evaluate'
                    ? { exceptionDetails: { exception: { description: 'TypeError: textContent' } } } : {};
            },
            evaluate: async expression => {
                if (expression === transition) {
                    if (++attempts === 1) throw new Error('Execution context destroyed');
                    return true;
                }
                if (expression.includes('readiness negative control')) throw new Error('Uncaught');
                if (expression.startsWith('document.querySelector("h1")?.textContent')) return expression.endsWith(JSON.stringify(heading));
                if (expression === 'Boolean(document.getElementById("__redweb_dev")?.shadowRoot)') return page !== 3 && page !== 4;
                if (expression === 'document.querySelector("h1").textContent') return 'Revision fixture';
                if (expression === 'document.getElementById("draft").value') return 'keep this draft';
                if (expression.includes('getBoundingClientRect')) return { x: 1, y: 1 };
                return true;
            }, socket: { terminate() { releases++; } } };
        },
    }).catch(error => error);
    expect(result).toBeUndefined();
    expect(attempts).toBe(2);
    expect([visits, releases]).toEqual([5, 5]);
});
