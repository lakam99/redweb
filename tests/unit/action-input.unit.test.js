const { z } = require('zod');
const { action, LivePage } = require('../..');
const { ActionDefinition } = require('../../src/htmx/ActionDefinition');
const { SchemaValidator } = require('../../src/validation/SchemaValidator');
const schema = validate => ({ '~standard': { version: 1, validate } });
const decorate = (Page, method, options) => action(options)(Page.prototype, method, Object.getOwnPropertyDescriptor(Page.prototype, method));

describe('validated action inputs', () => {
    test('transforms one input, keeps trusted context last, and preserves inheritance exposure', async () => {
        class Page extends LivePage { save(input, context) { return { input, context }; } }
        decorate(Page, 'save', { input: z.object({ age: z.string().transform(Number) }) });
        const page = new Page();
        const context = { principal: 'owner' };
        await expect(page._invoke('save', [{ age: '3' }], context)).resolves.toEqual({ input: { age: 3 }, context });
        await expect(page._invoke('save', [{ age: '3' }, { principal: 'forged' }], context)).rejects.toMatchObject({ code: 'ACTION_INVALID_INPUT' });
        await expect(page._invoke('save', [{ age: 3 }], context)).rejects.toMatchObject({ code: 'ACTION_INVALID_INPUT' });
        class Child extends Page {}
        await expect(new Child()._invoke('save', [{ age: '4' }], context)).resolves.toEqual({ input: { age: 4 }, context });
        class Hidden extends Page { save() { throw new Error('must not run'); } }
        await expect(new Hidden()._invoke('save', [{}], context)).rejects.toThrow('Unknown page action');
    });

    test('rejects invalid action configuration and contains validation failures', async () => {
        for (const options of [null, [], { other: true }, { validationTimeoutMs: 5 }, { input: {} }, { input: z.string(), validationTimeoutMs: 0 }]) {
            expect(() => action(options)).toThrow();
        }
        const hanging = new ActionDefinition({ input: schema(() => new Promise(() => {})), validationTimeoutMs: 5 });
        await expect(hanging.arguments([1], {})).rejects.toMatchObject({ code: 'ACTION_VALIDATION_TIMEOUT' });
        const failing = new ActionDefinition({ input: schema(() => { throw new Error('secret database password'); }) });
        await expect(failing.arguments([1])).rejects.toThrow('Action input validator failed.');
        const cancelled = new AbortController();
        cancelled.abort();
        await expect(hanging.arguments([1], { signal: cancelled.signal })).rejects.toMatchObject({ code: 'ACTION_CANCELLED' });
        expect(await new ActionDefinition().arguments([1, 2])).toEqual([1, 2]);
    });

    test('aborts active validators and ignores their eventual results', async () => {
        let finish;
        const controller = new AbortController();
        const validator = new SchemaValidator(schema(() => new Promise(resolve => { finish = resolve; })));
        const parsing = validator.parse(1, controller.signal);
        await Promise.resolve();
        controller.abort();
        await expect(parsing).rejects.toMatchObject({ reason: 'cancelled' });
        finish({ value: 4 });
        await new Promise(resolve => setImmediate(resolve));
        const early = new AbortController();
        const beforeWork = validator.parse(1, early.signal);
        early.abort();
        await expect(beforeWork).rejects.toMatchObject({ reason: 'cancelled' });
    });

    test.each([null, false, 'private validator bug'])('malformed issues (%p) are server failures', async issues => {
        const definition = new ActionDefinition({ input: schema(() => ({ issues })) });
        await expect(definition.arguments([1])).rejects.toThrow('Action input validator failed.');
    });

    test('does not invoke a disposed or replaced action after asynchronous validation', async () => {
        let finish;
        class Page extends LivePage { run() { throw new Error('must not run'); } }
        decorate(Page, 'run', { input: schema(() => new Promise(resolve => { finish = resolve; })) });
        const disposed = new Page();
        const pending = disposed._invoke('run', [1]);
        await Promise.resolve();
        await disposed.dispose();
        finish({ value: 1 });
        await expect(pending).rejects.toMatchObject({ code: 'ACTION_CANCELLED' });

        const replaced = new Page();
        const replacing = replaced._invoke('run', [1]);
        await Promise.resolve();
        replaced.run = () => 'replacement must not run either';
        finish({ value: 1 });
        await expect(replacing).rejects.toThrow('Unknown page action');
    });
});
