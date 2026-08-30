'use strict';
const { BoundedOperation, OperationInterrupted } = require('../async/BoundedOperation');

function isPrincipal(value) {
    return typeof value === 'string' || typeof value === 'bigint' || value === true || (typeof value === 'number' && Number.isFinite(value));
}

class AuthenticationFailure extends Error {
    constructor(code = 'AUTHENTICATION_REQUIRED', status = 401) {
        super('Page authentication did not complete successfully.');
        this.code = code;
        this.status = status;
    }
}

/** Bounded identity lookup; application code owns credential storage and revocation. */
class PageIdentity {
    constructor(authenticate, timeoutMs) {
        if (authenticate !== undefined && typeof authenticate !== 'function') throw new TypeError('`authenticate` must be a function.');
        if (authenticate === undefined && timeoutMs !== undefined) throw new TypeError('authenticationTimeoutMs requires authenticate.');
        this.authenticate = authenticate;
        this.boundary = new BoundedOperation(timeoutMs);
    }

    async resolve(request, signal) {
        if (!this.authenticate) return undefined;
        try {
            const principal = await this.boundary.run(() => this.authenticate(request), signal);
            if (!isPrincipal(principal)) throw new AuthenticationFailure();
            return principal;
        } catch (error) {
            if (error instanceof AuthenticationFailure) throw error;
            if (error instanceof OperationInterrupted) throw new AuthenticationFailure(error.reason === 'timeout' ? 'AUTHENTICATION_TIMEOUT' : 'AUTHENTICATION_CANCELLED', 503);
            throw new AuthenticationFailure('AUTHENTICATION_FAILED', 500);
        }
    }
}

module.exports = { PageIdentity, AuthenticationFailure, isPrincipal };
