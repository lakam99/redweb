const { AccessPolicy } = require('../../src/access/AccessPolicy');
const { action, LivePage } = require('../..');
const { z } = require('zod');
const { withTimeout } = require('../helpers/network');
const decorate = (Page, options) => action(options)(Page.prototype, 'run', Object.getOwnPropertyDescriptor(Page.prototype, 'run'));

describe('bounded action authorization', () => {
    test('requires explicit true and contains broken policies', async () => {
        for (const result of [false, undefined, null, 1, 'true', {}]) {
            await expect(new AccessPolicy(() => result).check({ principal: 'user' })).rejects.toMatchObject({ code: 'ACCESS_DENIED', status: 403 });
        }
        await expect(new AccessPolicy().check()).resolves.toBeUndefined();
        await expect(new AccessPolicy(() => true).check()).resolves.toBeUndefined();
        await expect(new AccessPolicy(() => { throw new Error('private credential'); }).check({})).rejects.toThrow('Authorization policy failed.');
        for (const options of [{ authorize: false }, { authorizationTimeoutMs: 5 }, { authorize: () => true, authorizationTimeoutMs: 0 }]) {
            expect(() => action(options)).toThrow();
        }
    });

    test('rejects expired work even when the deadline prevents policy entry', async () => {
        const signals = [];
        const slow = new AccessPolicy(context => { signals.push(context.signal); return new Promise(() => {}); }, 5);
        await expect(slow.check({})).rejects.toMatchObject({ code: 'ACCESS_TIMEOUT' });
        // Deadline checkpoints may reject before invoking application code.
        for (const signal of signals) expect(signal.aborted).toBe(true);
    });

    test('propagates cancellation after the policy has entered', async () => {
        const controller = new AbortController();
        let enter, aborted = false;
        const entered = new Promise(resolve => { enter = resolve; });
        const policy = new AccessPolicy(({ signal }) => {
            signal.addEventListener('abort', () => { aborted = true; }, { once: true });
            enter(signal);
            return new Promise(() => {});
        });
        // Observe rejection immediately, including when the entry wait fails.
        const pending = policy.check({ signal: controller.signal }).catch(error => error);
        let policySignal, failure;
        try { policySignal = await withTimeout(entered, 'authorization policy entry', 1000); }
        finally { controller.abort(); failure = await pending; }
        expect(failure).toMatchObject({ code: 'ACCESS_CANCELLED' });
        expect(policySignal.aborted).toBe(true);
        expect(aborted).toBe(true);
    });

    test('authorizes transformed inputs and fixes context position even without a schema', async () => {
        let received;
        class Page extends LivePage { run(input, context) { return { input, principal: context.principal }; } }
        decorate(Page, { input: z.string().transform(Number), authorize: (context, input) => {
            received = input;
            return context.principal === 'owner' && input === 3;
        } });
        await expect(new Page()._invoke('run', ['3'], { principal: 'owner' })).resolves.toEqual({ input: 3, principal: 'owner' });
        expect(received).toBe(3);
        await expect(new Page()._invoke('run', ['4'], { principal: 'owner' })).rejects.toMatchObject({ code: 'ACCESS_DENIED' });

        class Button extends LivePage { run(input, context) { return { input, principal: context.principal }; } }
        decorate(Button, { authorize: context => context.principal === 'owner' });
        await expect(new Button()._invoke('run', [], { principal: 'owner' })).resolves.toEqual({ input: undefined, principal: 'owner' });
        await expect(new Button()._invoke('run', ['input', { principal: 'forged' }], { principal: 'owner' })).rejects.toMatchObject({ code: 'ACTION_INVALID_INPUT' });
        await expect(new Button()._invoke('run', [{ principal: 'forged' }], { principal: 'owner' })).resolves.toEqual({ input: { principal: 'forged' }, principal: 'owner' });
    });

    test('aborts the policy signal when synchronous work finishes past its deadline', async () => {
        let policySignal;
        // Allow entry under an instrumented runner, then deliberately cross the
        // real deadline inside the callback. Production defaults are unchanged.
        const policy = new AccessPolicy(context => {
            policySignal = context.signal;
            const until = performance.now() + 1010;
            while (performance.now() < until) { /* Deliberately exercise non-preemptible application work. */ }
            return true;
        }, 1000);
        await expect(policy.check({})).rejects.toMatchObject({ code: 'ACCESS_TIMEOUT' });
        expect(policySignal.aborted).toBe(true);
    });

    test('does not invoke disposed or replaced methods after an authorization check', async () => {
        let finish;
        class Page extends LivePage { run() { throw new Error('must not run'); } }
        decorate(Page, { authorize: () => new Promise(resolve => { finish = resolve; }) });
        const disposed = new Page();
        const pending = disposed._invoke('run', []);
        await Promise.resolve();
        await disposed.dispose();
        finish(true);
        await expect(pending).rejects.toMatchObject({ code: 'ACTION_CANCELLED' });
        const replaced = new Page();
        const replacing = replaced._invoke('run', []);
        await Promise.resolve();
        replaced.run = () => 'must not run replacement';
        finish(true);
        await expect(replacing).rejects.toThrow('Unknown page action');
    });
});
