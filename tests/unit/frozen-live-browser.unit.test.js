'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { FrozenBrowserBoundary } = require('../helpers/FrozenBrowserBoundary');
const { withTimeout } = require('../helpers/network');
const flush = () => new Promise(setImmediate);
const browserSource = fs.readFileSync(path.resolve(__dirname, '../../scripts/verify-live-html-browser.js'), 'utf8');

async function boundary(options, assertion) {
    await new VerificationWorkspace().run(async owner => {
        const probe = new FrozenBrowserBoundary(owner.directory, options);
        try { await assertion(probe); } finally { probe.collect(); }
    });
}

// Each independent false observation exercises the host's rejection, not a fake DOM.
const observations = [
    ['invalid form', e => e.startsWith('actionErrors[0].code'), 'Invalid form input was reset or disclosed by validation.'],
    ['action scope', e => e.includes('form[data-rw-component="second"] output'), 'Validated action escaped its component scope.'],
    ['counter CSS', e => e.startsWith('getComputedStyle') && e.includes("'output'"), 'Counter CSS was not applied: false'],
    ['chat validation', e => e.includes("Boolean(document.querySelector('[data-rw-feedback]')"), 'Invalid chat input lost its draft or automatic feedback.'],
    ['chat draft', e => e.includes("return input.value === 'draft survives presence'"), 'A presence update replaced the active chat composer.'],
    ['chat safety', e => e === 'window.__redwebInjected !== true', 'Escaped chat content executed in the browser.'],
    ['chat CSS', e => e.startsWith('getComputedStyle') && e.includes("'.composer button'"), 'Chatroom CSS was not applied: false'],
    ['cards CSS', e => e.startsWith('getComputedStyle') && e.includes("'.card'"), 'Card CSS was not applied: false'],
    ['component scope', e => e.includes('output[data-rw-component="secondary"]'), 'A component action updated a sibling component instance.'],
    ['JSX CSS', e => e.startsWith('getComputedStyle') && e.includes("'.counter-card'"), 'TSX page CSS was not applied: false'],
    ['keyed identity', e => e.includes('savedInput ==='), 'Reactive keyed rendering lost node identity, draft input, selection, focus, or component state.'],
    ['sibling identity', e => e.trim() === "savedSecondary === document.querySelector('#secondary')", 'Removing a sibling replaced an unrelated identified element.'],
    ['local form input', e => e.includes(".value === 'draft text'"), 'Unchanged server values erased local form input.'],
    ['changed server values', e => e.includes(".value === 'server text'"), 'Changed server form values were not applied.'],
    ['restricted boundaries', e => e.includes("parentElement.tagName === 'TBODY'"), 'Component boundaries changed restricted HTML structure or required inline styles.'],
    ['noscript', e => e.includes('after.compareDocumentPosition'), 'Scripting-enabled noscript parsing diverged from server rendering.'],
    ['plaintext DOM', e => e.includes("document.body.textContent.includes('{{ value }}')"), 'Plaintext content became active browser DOM.'],
    ['documentation composition', e => e.includes("document.querySelectorAll('article').length"), 'Documentation composition helpers produced incorrect browser DOM.'],
    ['JSX safety', e => e.includes('window.__redwebJsxInjected !== true'), 'Escaped JSX content executed or composed incorrectly in the browser.'],
];

test('the native JSX action oracle follows the wrapper-free counter markup safely', () => {
    expect(browserSource).toContain(`document.querySelector('[rw-click="increment"]')?.textContent.trim() === 'Count 1'`);
    expect(browserSource).not.toContain(`document.querySelector('output').textContent === '1'`);
});

test.each(observations)('frozen main rejects a failed %s observation and performs its normal cleanup', async (_label, select, message) => {
    let selected = 0;
    await boundary({ rejectObservation: expression => { const match = select(expression); if (match) selected++; return match; } }, async probe => {
        await expect(probe.context.main()).rejects.toThrow(message);
        expect(selected).toBeGreaterThan(0);
        expect(probe.logs).toEqual([]);
        expect(probe.apps.map(app => app.stops)).toEqual(Array(8).fill(1));
        expect(probe.sockets.every(socket => socket.closed === 1)).toBe(true);
        expect(probe.children[0].signalCode).toBe('SIGTERM');
        expect(probe.removals).toHaveLength(1);
        expect(probe.timers.size).toBe(0);
    });
});

test('frozen main completes the synthetic orchestration with delayed listeners and candidate discovery', async () => {
    await boundary({ candidates: true, delayedListening: true }, async probe => {
        await probe.context.main();
        expect(probe.logs).toHaveLength(1);
        expect(probe.logs[0]).toContain('Live HTML browser gate passed:');
        expect(probe.sockets).toHaveLength(13);
        expect(probe.sockets.every(socket => socket.closed === 1)).toBe(true);
        expect(probe.apps.map(app => app.stops)).toEqual(Array(8).fill(1));
        expect(fs.readdirSync(probe.directory)).toEqual([]);
    });
});

test.each(['allow', 'wrong-error'])('frozen main requires a TypeError for terminal JSX (%s)', async plaintext => {
    await boundary({ plaintext }, async probe => {
        await expect(probe.context.main()).rejects.toThrow('JSX allowed a terminal plaintext element.');
        expect(probe.logs).toEqual([]);
        expect(probe.apps.every(app => app.stops === 1)).toBe(true);
    });
});

test('CLI reports missing-browser failure before acquiring applications', async () => {
    await boundary({ cli: true, candidates: true, noBrowser: true, platform: 'linux' }, async probe => {
        await withTimeout(probe.done, 'unit CLI completion', 1000);
        expect(probe.errors).toHaveLength(1);
        expect(probe.errors[0].message).toBe('Chrome, Edge, or Chromium is required for the Live HTML browser gate.');
        expect(probe.context.process.exitCode).toBe(1);
        expect(probe.apps).toEqual([]);
        expect(probe.api.browserCandidates).toContain('/usr/bin/chromium');
    });
});

test.each([false, true])('profile cleanup failure is retained with primary failure=%s', async feedbackFailure => {
    await boundary({ feedbackFailure, profileFailure: true }, async probe => {
        let failure;
        try { await probe.context.main(); } catch (error) { failure = error; }
        if (feedbackFailure) {
            expect(failure).toBeInstanceOf(AggregateError);
            expect(failure.cause).toBe(probe.primary);
            expect(failure.errors).toEqual([probe.primary, probe.cleanup]);
        } else expect(failure).toBe(probe.cleanup);
        expect(probe.logs).toHaveLength(feedbackFailure ? 0 : 1); // Banner precedes cleanup.
        expect(probe.apps.every(app => app.stops === 1)).toBe(true);
        expect(fs.readdirSync(probe.directory)).toHaveLength(1);
    });
});

test('characterizes frozen pre-try acquisition: a partial startup skips earlier cleanup', async () => {
    await boundary({ startFailure: 3 }, async probe => {
        await expect(probe.context.main()).rejects.toBe(probe.primary);
        expect(probe.apps.map(app => app.stops)).toEqual([0, 0, 0]);
        expect(probe.children).toEqual([]);
        expect(probe.removals).toEqual([]);
        expect(fs.readdirSync(probe.directory)).toHaveLength(1);
    });
});

test.each(['close', 'kill', 'shutdown'])('characterizes frozen synchronous %s cleanup failure skipping later cleanup', async stage => {
    await boundary({ closeFailure: stage === 'close', killFailure: stage === 'kill', shutdown: stage === 'shutdown' ? 'throw' : undefined }, async probe => {
        await expect(probe.context.main()).rejects.toBe(probe.cleanup);
        expect(probe.logs).toHaveLength(1);
        expect(probe.removals).toEqual([]);
        expect(probe.apps.map(app => app.stops)).toEqual(stage === 'shutdown' ? [1, 0, 0, 0, 0, 0, 0, 0] : Array(8).fill(0));
        expect(probe.sockets.filter(socket => socket.closed).length).toBe(stage === 'close' ? 1 : 13);
    });
});

test('characterizes frozen shutdown rejection being ignored, not verified cleanup', async () => {
    await boundary({ shutdown: 'reject' }, async probe => {
        await expect(probe.context.main()).resolves.toBeUndefined();
        expect(probe.apps.map(app => app.stops)).toEqual(Array(8).fill(1));
        expect(probe.logs).toHaveLength(1);
    });
});

test('characterizes frozen browser cleanup masking an earlier workload error', async () => {
    await boundary({ feedbackFailure: true, killFailure: true }, async probe => {
        await expect(probe.context.main()).rejects.toBe(probe.cleanup);
        expect(probe.logs).toEqual([]);
        expect(probe.apps.every(app => app.stops === 0)).toBe(true);
        expect(probe.removals).toEqual([]);
    });
});

test('characterizes frozen falsy thrown value being swallowed without a success banner', async () => {
    await boundary({ falsyFailure: true }, async probe => {
        await expect(probe.context.main()).resolves.toBeUndefined();
        expect(probe.logs).toEqual([]);
        expect(probe.apps.every(app => app.stops === 1)).toBe(true);
    });
});

test('listener helper propagates an early server error', async () => {
    await boundary({}, async probe => {
        const server = Object.assign(new EventEmitter(), { listening: false });
        const result = probe.context.waitForListening(server);
        server.emit('error', probe.primary);
        await expect(result).rejects.toBe(probe.primary);
    });
});

test.each(['GET', 'invalidJson', 'httpError', 'socketError', 'commandError', 'evaluationError'])('protocol boundary handles %s', async mode => {
    await boundary({ [mode]: true }, async probe => {
        if (mode === 'GET') {
            await expect(probe.context.jsonRequest('http://unit/')).resolves.toEqual({ webSocketDebuggerUrl: 'ws://unit' });
            expect(probe.requests).toEqual([{ url: 'http://unit/', method: 'GET' }]);
        } else {
            const result = probe.api.openPage(9222, 'http://unit/');
            if (['httpError', 'socketError'].includes(mode)) await expect(result).rejects.toBe(probe.primary);
            else await expect(result).rejects.toThrow(mode === 'commandError' ? 'unit command error'
                : mode === 'evaluationError' ? 'unit evaluation exception' : /JSON|Expected|property/);
            // Frozen openPage does not close a partially acquired socket on failure.
            expect(probe.sockets.every(socket => socket.closed === 0)).toBe(true);
        }
    });
});

test('characterizes a pending CDP command not being rejected when its socket closes', async () => {
    await boundary({}, async probe => {
        const page = await probe.api.openPage(9222, 'data:text/html,unit');
        probe.respond = () => {}; // Explicit no-response unit boundary, no native socket.
        let settled = false;
        void page.command('unit.pending').then(() => { settled = true; }, () => { settled = true; });
        page.socket.close(); page.socket.emit('close');
        await flush();
        expect(settled).toBe(false);
        expect(probe.timers.size).toBe(0);
    });
});

test('CDP ignores unsolicited events and unknown response IDs while preserving later commands', async () => {
    await boundary({}, async probe => {
        const page = await probe.api.openPage(9222, 'data:text/html,unit');
        page.socket.emit('message', JSON.stringify({ method: 'unsubscribed', params: {} }));
        page.socket.emit('message', JSON.stringify({ id: 999999, result: {} }));
        await expect(page.evaluate('unit observation')).resolves.toBe(true);
        expect(probe.requests[0].method).toBe('PUT');
    });
});

test.each([['error', 'working'], ['exit', 'error']])('browser retry preserves failed attempts %j', async (first, second) => {
    await boundary({ launch: [first, second] }, async probe => {
        const result = probe.api.launchBrowserWithRetry('unit-browser', probe.directory);
        if (second === 'working') {
            await expect(result).resolves.toMatchObject({ endpoint: 'ws://127.0.0.1:9222/unit' });
            expect(probe.children[0].kills).toEqual([undefined]);
        } else {
            let failure;
            try { await result; } catch (error) { failure = error; }
            expect(failure).toBeInstanceOf(AggregateError);
            expect(failure.errors[0].message).toContain('Browser exited early (3). unit startup diagnostic');
            expect(failure.errors[1]).toBe(probe.primary);
            expect(probe.children[0].kills).toEqual([]);
        }
        expect(probe.children).toHaveLength(2);
        expect(probe.timers.size).toBe(0);
    });
});

test('browser startup deadline includes collected stderr', async () => {
    await boundary({ launch: ['timeout'] }, async probe => {
        const browser = probe.context.launchBrowser('unit-browser', probe.directory);
        const rejected = expect(browser.endpoint).rejects.toThrow('Browser did not expose DevTools. unit startup diagnostic');
        await flush(); probe.tick(); await rejected;
        await probe.api.stopBrowser(browser.child);
        expect(probe.timers.size).toBe(0);
    });
});

test('headed browser launch omits headless mode and allows its window to be shown', async () => {
    await boundary({}, async probe => {
        const browser = probe.context.launchBrowser('unit-browser', probe.directory, { headless: false });
        await expect(browser.endpoint).resolves.toBe('ws://127.0.0.1:9222/unit');
        expect(probe.children[0].args).not.toContain('--headless=new');
        expect(probe.children[0].settings.windowsHide).toBe(false);
        await probe.api.stopBrowser(browser.child);
    });
});

test('browser shutdown handles no child, completed child, and asynchronous exit', async () => {
    await boundary({ asyncExit: true }, async probe => {
        await probe.api.stopBrowser();
        const child = probe.spawn('unit', [], {});
        await flush();
        await probe.api.stopBrowser(child);
        await probe.api.stopBrowser(child);
        expect(child.kills).toEqual([undefined]);
        expect(child.listenerCount('exit')).toBe(0);
        expect(probe.timers.size).toBe(0);
    });
});

test('characterizes frozen stubborn browser shutdown resolving after both deadlines without confirmed exit', async () => {
    await boundary({ stubborn: true }, async probe => {
        const child = probe.spawn('unit', [], {});
        await flush();
        const stopped = probe.api.stopBrowser(child);
        probe.tick(); await flush(); probe.tick(); await stopped;
        expect(child.kills).toEqual([undefined, 'SIGKILL']);
        expect(child.exitCode).toBeNull(); expect(child.signalCode).toBeNull();
        expect(probe.time).toBe(4000);
        expect(probe.timers.size).toBe(0);
        expect(child.listenerCount('exit')).toBe(0);
    });
});

test.each(['EBUSY', 'ENOTEMPTY', 'EPERM'])('profile removal retries transient %s with a bounded deadline', async code => {
    let attempts = 0;
    await boundary({ remove: directory => {
        if (attempts++ === 0) throw Object.assign(new Error('unit busy directory'), { code });
        fs.rmSync(directory, { recursive: true, force: true });
    } }, async probe => {
        const target = path.join(probe.directory, 'owned-profile'); fs.mkdirSync(target);
        const removed = probe.api.removeTemporaryDirectory(target);
        probe.tick(); await removed;
        expect(attempts).toBe(2); expect(probe.time).toBe(100);
        expect(fs.existsSync(target)).toBe(false);
    });
});

test('persistent profile contention rejects the original error at the deadline', async () => {
    const busy = Object.assign(new Error('unit permanently busy'), { code: 'EBUSY' });
    await boundary({ remove: () => { throw busy; } }, async probe => {
        const removed = probe.api.removeTemporaryDirectory(probe.directory);
        const rejected = expect(removed).rejects.toBe(busy);
        for (let i = 0; i < 50; i++) { probe.tick(); await flush(); }
        await rejected;
        expect(probe.time).toBe(5000); expect(probe.removals).toHaveLength(51);
    });
});

test('generated eventual expression waits for a condition and rejects its named deadline', async () => {
    await boundary({}, async probe => {
        const success = { ready: false, Date, setTimeout: callback => { success.ready = true; queueMicrotask(callback); } };
        await expect(vm.runInNewContext(probe.api.eventual('ready', 'unit readiness'), success)).resolves.toBe(true);
        let time = 0;
        const failure = { Date: { now: () => time += 7000 }, setTimeout };
        await expect(vm.runInNewContext(probe.api.eventual('false', 'unit deadline'), failure)).rejects.toThrow('Timed out waiting for unit deadline');
    });
});
