const { z } = require('zod');
const { defineSocketContract } = require('../../contract');

const schema = validate => ({ '~standard': { version: 1, vendor: 'test-validator', validate } });

describe('shared socket contracts with real validators', () => {
    test('infers from and validates through the same Standard Schema, including async transforms', async () => {
        const contract = defineSocketContract('1', {
            join: z.object({ name: z.string().trim().min(1) }),
            move: z.object({ x: z.number().min(-1).max(1) }).strict(),
            resume: z.string().transform(async text => text.length),
        });
        expect(Object.isFrozen(contract)).toBe(true);
        expect(Object.isFrozen(contract.protocol.versions)).toBe(true);
        expect(contract.types).toEqual(['join', 'move', 'resume']);
        expect(await contract.parse('join', { name: ' Ada ' })).toEqual({ name: 'Ada' });
        expect(await contract.parse('resume', 'token')).toBe(5);
        await expect(contract.parse('move', { x: 3 })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
        await expect(contract.parse('move', { x: 1, y: 2 })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
        await expect(contract.parse('missing', {})).rejects.toMatchObject({ code: 'UNKNOWN_HANDLER' });
        expect(() => contract.handler('missing', () => {})).toThrow('not defined');
        expect(() => contract.handler('join', null)).toThrow('callback');
    });

    test('rejects invalid configuration before constructing any route or connection', () => {
        const valid = { join: z.string() };
        for (const version of ['', null, 'x'.repeat(257), 'x'.repeat(65)]) expect(() => defineSocketContract(version, valid)).toThrow();
        for (const schemas of [null, [], 1, {}, { error: z.string() }, { '': z.string() }, { join: null },
            { join: { '~standard': { version: 2, validate() {} } } }, { join: { '~standard': { version: 1 } } },
            Object.fromEntries(Array.from({ length: 257 }, (_, i) => [String(i), z.string()])),
        ]) expect(() => defineSocketContract('1', schemas)).toThrow();
        for (const options of [null, [], { validationTimeoutMs: 0 }, { validationTimeoutMs: 1.2 }, { validationTimeoutMs: Infinity }, { validationTimeoutMs: 2147483648 }]) {
            expect(() => defineSocketContract('1', valid, options)).toThrow();
        }
    });

    test('contains validator errors, malformed responses, and never-settling validators', async () => {
        for (const output of [null, 1, [], {}, { issues: [] }, { issues: ['secret'] }]) {
            const contract = defineSocketContract('1', { value: schema(() => output) });
            await expect(contract.parse('value', 1)).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
        }
        const failing = defineSocketContract('1', { value: schema(() => { throw new Error('private data'); }) });
        await expect(failing.parse('value', 1)).rejects.toThrow('Payload does not match');
        const hanging = defineSocketContract('1', { value: schema(() => new Promise(() => {})) }, { validationTimeoutMs: 5 });
        await expect(hanging.parse('value', 1)).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
        await expect(failing.send({}, 'value', 1)).rejects.toThrow('negotiate');
    });

    test('keeps thenable outputs inside the deadline and sanitizes their rejections', async () => {
        const resolved = defineSocketContract('1', { value: schema(() => ({ value: Promise.resolve(4) })) });
        expect(await resolved.parse('value', null)).toBe(4);
        const rejected = defineSocketContract('1', { value: schema(() => ({ value: Promise.reject(new Error('private output')) })) });
        await expect(rejected.parse('value', null)).rejects.toThrow('Payload does not match');
        const pending = defineSocketContract('1', { value: schema(() => ({ value: new Promise(() => {}) })) }, { validationTimeoutMs: 5 });
        await expect(pending.parse('value', null)).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
        const blocking = defineSocketContract('1', { value: schema(() => {
            const until = performance.now() + 5;
            while (performance.now() < until) { /* Real CPU-bound validator, not a fake clock. */ }
            return { value: 1 };
        }) }, { validationTimeoutMs: 1 });
        await expect(blocking.parse('value', null)).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
    });
});
