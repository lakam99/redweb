'use strict';

const { sameOrigin } = require('../../src/access/sameOrigin');

const request = (host = 'game.example', extra = {}) => ({
    headers: { host, ...extra }, socket: { encrypted: false },
});

describe('same-origin boundary', () => {
    test('requires a usable origin and host', () => {
        expect(sameOrigin(null, 'http://game.example')).toBe(false);
        expect(sameOrigin(request(), null)).toBe(false);
        expect(sameOrigin(request(5), 'http://game.example')).toBe(false);
        expect(sameOrigin(request(), 'not a URL')).toBe(false);
    });

    test('matches the complete browser origin, not merely the hostname', () => {
        expect(sameOrigin(request(), 'http://GAME.example')).toBe(true);
        for (const origin of ['https://game.example', 'http://other.example',
            'http://user:pass@game.example', 'http://game.example/path',
            'http://game.example/?x=1', 'http://game.example/#fragment',
            'ftp://game.example']) expect(sameOrigin(request(), origin)).toBe(false);
    });

    test('supports TLS and an explicitly trusted proxy without trusting forwarded headers by default', () => {
        expect(sameOrigin({ headers: { host: 'game.example' }, socket: { encrypted: true } },
            'https://game.example')).toBe(true);
        const proxied = request('game.example', { 'x-forwarded-proto': 'https, http' });
        expect(sameOrigin(proxied, 'https://game.example')).toBe(false);
        expect(sameOrigin(proxied, 'https://game.example', true)).toBe(true);
        expect(sameOrigin(request('game.example', { 'x-forwarded-proto': 5 }),
            'http://game.example', true)).toBe(true);
        expect(sameOrigin({ ...request(), protocol: 'https' }, 'https://game.example')).toBe(true);
    });
});
