const {
    ProtocolPolicy,
    PROTOCOL_CONTEXT,
    PROTOCOL_REJECTION,
    ERROR_CODES,
} = require('../../src/ws/ProtocolPolicy');
const { ProtocolClient, ERROR_CODES: CLIENT_ERROR_CODES } = require('../../client');

const codec = overrides => ({
    encode: value => Buffer.from(JSON.stringify(value)),
    decode: buffer => JSON.parse(buffer.toString()),
    ...overrides,
});

describe('ProtocolPolicy', () => {
    test.each([
        [undefined, '`protocol`'],
        [null, '`protocol`'],
        [[], '`protocol`'],
        [{}, '`protocol.versions`'],
        [{ versions: [] }, '`protocol.versions`'],
        [{ versions: Array.from({ length: 17 }, (_, index) => String(index)) }, '`protocol.versions`'],
        [{ versions: [1] }, 'protocol version'],
        [{ versions: [''] }, 'protocol version'],
        [{ versions: ['x'.repeat(65)] }, 'protocol version'],
        [{ versions: ['1', '1'] }, 'unique'],
        [{ versions: ['1'], required: 'yes' }, '`protocol.required`'],
        [{ versions: ['1'], queryParameter: '' }, 'protocol.queryParameter'],
        [{ versions: ['1'], header: '' }, 'protocol.header'],
        [{ versions: ['1'], binary: null }, '`protocol.binary`'],
        [{ versions: ['1'], binary: [] }, '`protocol.binary`'],
        [{ versions: ['1'], binary: {} }, 'requires `encode` and `decode`'],
        [{ versions: ['1'], binary: codec({ encode: null }) }, 'requires `encode` and `decode`'],
        [{ versions: ['1'], binary: codec({ maxBytes: 0 }) }, '`protocol.binary.maxBytes`'],
        [{ versions: ['1'], binary: codec({ maxBytes: 1.5 }) }, '`protocol.binary.maxBytes`'],
    ])('validates protocol configuration %#', (options, message) => {
        expect(() => new ProtocolPolicy(options)).toThrow(message);
    });

    test('negotiates query, header arrays, optional defaults, and bounded rejection metadata', () => {
        const policy = new ProtocolPolicy({ versions: ['2', '1'], queryParameter: 'v', header: 'X-Game-Version' });
        const query = { url: '/play?v=2', headers: { host: 'game.example', 'x-game-version': '1' } };
        expect(policy.negotiate(query)).toBe(true);
        expect(query[PROTOCOL_CONTEXT]).toEqual({ version: '2' });
        expect(Object.isFrozen(query[PROTOCOL_CONTEXT])).toBe(true);

        const header = { url: '/play', headers: { 'x-game-version': ['1', '2'] } };
        expect(policy.negotiate(header)).toBe(true);
        expect(header[PROTOCOL_CONTEXT]).toEqual({ version: '1' });

        const missing = { headers: {} };
        expect(policy.negotiate(missing)).toBe(false);
        expect(missing[PROTOCOL_REJECTION]).toEqual({
            statusCode: 426,
            statusText: 'Upgrade Required',
            headers: { 'Redweb-Versions': '2, 1' },
            message: 'A supported protocol version is required.',
        });
        const unsupported = { url: '/?v=3', headers: {} };
        expect(policy.negotiate(unsupported)).toBe(false);
        const malformed = { url: '/', headers: { host: '[' } };
        expect(policy.negotiate(malformed)).toBe(false);
        expect(malformed[PROTOCOL_REJECTION].message).toContain('Malformed');

        const optional = new ProtocolPolicy({ versions: ['1'], required: false, binary: false });
        const defaulted = {};
        expect(optional.negotiate(defaulted)).toBe(true);
        expect(defaulted[PROTOCOL_CONTEXT]).toEqual({ version: '1' });
    });

    test('creates and validates stable event and error envelopes', () => {
        const policy = new ProtocolPolicy({ versions: ['1'] });
        expect(policy.envelope('1', 'state', { score: 2 })).toEqual({ v: '1', type: 'state', payload: { score: 2 } });
        expect(policy.envelope('1', 'state', null, { requestId: 'r1', sequence: 0 })).toEqual({
            v: '1', type: 'state', payload: null, requestId: 'r1', sequence: 0,
        });
        expect(policy.error('1', ERROR_CODES.UNKNOWN_HANDLER, 'missing', { requestId: 'r2' })).toEqual({
            v: '1', type: 'error', error: { code: 'UNKNOWN_HANDLER', message: 'missing' }, requestId: 'r2',
        });
        for (const action of [
            () => policy.envelope('1', '', null),
            () => policy.envelope('1', 'x'.repeat(257), null),
            () => policy.envelope('1', 'x', null, { requestId: '' }),
            () => policy.envelope('1', 'x', null, { sequence: -1 }),
            () => policy.envelope('1', 'x', null, { sequence: 1.5 }),
            () => policy.error('1', '', 'message'),
            () => policy.error('1', 'CODE', ''),
        ]) expect(action).toThrow();

        const valid = { v: '1', type: 'move', payload: {}, requestId: 'r', sequence: 1 };
        expect(policy.validateEnvelope(valid, '1')).toBe(true);
        for (const invalid of [
            null, 'x', {}, { ...valid, v: '2' }, { ...valid, type: 1 }, { ...valid, type: '' },
            { ...valid, type: 'x'.repeat(257) }, { ...valid, requestId: 1 }, { ...valid, requestId: '' },
            { ...valid, requestId: 'x'.repeat(257) }, { ...valid, sequence: -1 }, { ...valid, sequence: 1.5 },
            { v: '1', type: 'move' }, { ...valid, error: {} },
            { v: '1', type: 'error', payload: null, error: { code: 'X', message: 'x' } },
            { v: '1', type: 'error' }, { v: '1', type: 'error', error: null },
            { v: '1', type: 'error', error: { code: '', message: 'x' } },
            { v: '1', type: 'error', error: { code: 'X', message: '' } },
        ]) expect(policy.validateEnvelope(invalid, '1')).toBe(false);
        expect(policy.validateEnvelope({
            v: '1', type: 'error', error: { code: 'X', message: 'failed' }, requestId: 'r',
        }, '1')).toBe(true);
    });

    test('bounds and validates pluggable binary codecs', async () => {
        const context = { protocol: { version: '1' } };
        const disabled = new ProtocolPolicy({ versions: ['1'] });
        expect(await disabled.decodeBinary(Buffer.from('x'), context)).toBeNull();
        expect(await disabled.encodeBinary({}, context)).toBeNull();

        const policy = new ProtocolPolicy({ versions: ['1'], binary: codec({ maxBytes: 32 }) });
        expect(await policy.decodeBinary(Buffer.from('{"v":"1"}'), context)).toEqual({ v: '1' });
        expect(await policy.decodeBinary(Buffer.alloc(33), context)).toBeNull();
        expect(await policy.encodeBinary({ v: '1' }, context)).toEqual(Buffer.from('{"v":"1"}'));
        expect(await policy.encodeBinary('x'.repeat(40), context)).toBeNull();

        for (const encoded of [new Uint8Array([1, 2]), new Uint8Array([3]).buffer]) {
            const variant = new ProtocolPolicy({ versions: ['1'], binary: codec({ encode: () => encoded }) });
            expect(Buffer.isBuffer(await variant.encodeBinary({}, context))).toBe(true);
        }
        const invalid = new ProtocolPolicy({ versions: ['1'], binary: codec({ encode: () => 'bad' }) });
        await expect(invalid.encodeBinary({}, context)).rejects.toThrow('must return');
    });
});

describe('ProtocolClient', () => {
    test('shares generated codes and sends and parses envelopes', () => {
        const sent = [];
        const client = new ProtocolClient({ send: value => sent.push(value) }, '1');
        expect(CLIENT_ERROR_CODES).toEqual(ERROR_CODES);
        expect(client.envelope('move', { x: 1 }, { requestId: 'r', sequence: 2 })).toEqual({
            v: '1', type: 'move', payload: { x: 1 }, requestId: 'r', sequence: 2,
        });
        client.send('move', { x: 2 });
        expect(client.parse(sent[0])).toEqual({ v: '1', type: 'move', payload: { x: 2 } });
        expect(client.parse({ data: Buffer.from(sent[0]) })).toEqual({ v: '1', type: 'move', payload: { x: 2 } });
    });

    test('rejects invalid client inputs and received versions', () => {
        expect(() => new ProtocolClient(null, '1')).toThrow('socket');
        expect(() => new ProtocolClient({ send() {} }, '')).toThrow('version');
        const client = new ProtocolClient({ send() {} }, '1');
        for (const action of [
            () => client.envelope('', {}),
            () => client.envelope('move', {}, { requestId: '' }),
            () => client.envelope('move', {}, { sequence: -1 }),
            () => client.envelope('move', {}, { sequence: 1.5 }),
            () => client.parse('{'),
            () => client.parse(JSON.stringify({ v: '2', type: 'move' })),
            () => client.parse(JSON.stringify({ v: '1' })),
            () => client.parse(JSON.stringify({ v: '1', type: '', payload: null })),
            () => client.parse(JSON.stringify({ v: '1', type: 'move' })),
            () => client.parse(JSON.stringify({ v: '1', type: 'move', payload: {}, requestId: '' })),
            () => client.parse(JSON.stringify({ v: '1', type: 'move', payload: {}, sequence: -1 })),
            () => client.parse(JSON.stringify({ v: '1', type: 'error', error: {} })),
        ]) expect(action).toThrow();
    });
});
