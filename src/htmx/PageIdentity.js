'use strict';
const { BoundedOperation, OperationInterrupted } = require('../async/BoundedOperation');
const AuthenticationFailure = require('../access/AuthenticationFailure');

function isPrincipal(value) {
    return typeof value === 'string' || typeof value === 'bigint' || value === true || (typeof value === 'number' && Number.isFinite(value));
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
            if (error instanceof AuthenticationFailure) throw new AuthenticationFailure(error.code);
            if (error instanceof OperationInterrupted) throw new AuthenticationFailure(error.reason === 'timeout' ? 'AUTHENTICATION_TIMEOUT' : 'AUTHENTICATION_CANCELLED');
            throw new AuthenticationFailure('AUTHENTICATION_FAILED');
        }
    }
}

module.exports = { PageIdentity, AuthenticationFailure, isPrincipal };
