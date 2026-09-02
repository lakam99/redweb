'use strict';
const { RequestFailure } = require('../../src/access/RequestFailure');
const AuthenticationFailure = require('../../src/access/AuthenticationFailure');
const { AccessDenied } = require('../../src/access/AccessPolicy');

describe('fixed safe request failures', () => {
    test('unknown and forged exception fields cannot become headers, statuses or messages', () => {
        const forged = new AuthenticationFailure(); forged.code = 'private-secret'; forged.status = 302;
        for (const error of [new Error('private-secret'), { code: 'ACCESS_DENIED' }, forged]) {
            const failure = RequestFailure.from(error);
            expect(failure.code).toBe('ADMISSION_FAILED');
            expect(failure.status).toBe(500);
            expect(JSON.stringify(failure)).not.toContain('private-secret');
        }
        const denied = new AccessDenied(); denied.message = 'private-secret'; denied.status = 302;
        expect(RequestFailure.from(denied)).toMatchObject({ code: 'ACCESS_DENIED', status: 403, message: 'This operation is not permitted.' });
        const failed = new RequestFailure('PAGE_FAILED'); failed.message = 'private-secret'; failed.status = 302;
        expect(RequestFailure.from(failed)).toMatchObject({ code: 'PAGE_FAILED', status: 500, message: 'Page request failed.' });
        expect(Object.isFrozen(failed.rejection.headers)).toBe(true);
        const throwing = new AccessDenied();
        Object.defineProperty(throwing, 'code', { get() { throw new Error('private-secret'); } });
        const coerced = new AccessDenied();
        coerced.code = { toString() { throw new Error('Code must not be coerced'); } };
        for (const error of [throwing, coerced]) expect(RequestFailure.from(error).code).toBe('ADMISSION_FAILED');
    });

    test('typed access/authentication errors normalize invalid codes and policy messages', async () => {
        const ActionInputError = require('../../src/validation/ActionInputError');
        for (const code of [null, 'UNKNOWN', 'ACCESS_UNKNOWN', 'AUTHENTICATION_UNKNOWN']) {
            expect(new AccessDenied(code)).toMatchObject({ code: 'ACCESS_DENIED', status: 403 });
            expect(new AuthenticationFailure(code)).toMatchObject({ code: 'AUTHENTICATION_FAILED', status: 500 });
            expect(new ActionInputError(code).code).toBe('ACTION_INVALID_INPUT');
        }
        expect(new ActionInputError('ACTION_UNKNOWN').code).toBe('ACTION_INVALID_INPUT');
        const { AccessPolicy } = require('../../src/access/AccessPolicy');
        const error = new AccessDenied(); error.message = 'private-secret';
        await expect(new AccessPolicy(() => { throw error; }).check()).rejects.toMatchObject({ message: 'This operation is not permitted.' });
    });

    test('transport destruction before the close event cannot commit admission', async () => {
        const { EventEmitter } = require('events');
        const { AdmissionPolicy } = require('../../src/ws/AdmissionPolicy');
        const { UPGRADE_REJECTION } = require('../../src/access/RequestFailure');
        const transport = new EventEmitter(); transport.destroyed = false;
        const policy = new AdmissionPolicy(() => { transport.destroyed = true; return true; });
        const request = { headers: {} };
        expect(await policy.authorize(request, transport, { resolveRemoteAddress: () => 'local' })).toBe(false);
        expect(request[UPGRADE_REJECTION].headers['Redweb-Error']).toBe('ADMISSION_CANCELLED');
    });
});
