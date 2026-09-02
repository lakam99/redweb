const { BoundedOperation, OperationInterrupted } = require('../async/BoundedOperation');
const codes = require('./failure-codes.json');

class AccessDenied extends Error {
    constructor(code = 'ACCESS_DENIED') {
        const safeCode = typeof code === 'string' && code.startsWith('ACCESS_') && Object.hasOwn(codes, code) ? code : 'ACCESS_DENIED';
        super(codes[safeCode].message);
        this.code = safeCode;
        this.status = codes[safeCode].status;
    }
}

/** Explicit permission, not identity lookup. Only a literal true permits work. */
class AccessPolicy {
    constructor(authorize, timeoutMs) {
        if (authorize !== undefined && typeof authorize !== 'function') throw new TypeError('authorize must be a function.');
        if (authorize === undefined && timeoutMs !== undefined) throw new TypeError('authorizationTimeoutMs requires authorize.');
        this.authorize = authorize;
        this.boundary = new BoundedOperation(timeoutMs);
        Object.freeze(this);
    }

    async check(context, input) {
        if (!this.authorize) return;
        try {
            const allowed = await this.boundary.run(signal => this.authorize(Object.freeze({ ...context, signal }), input), context?.signal);
            if (allowed !== true) throw new AccessDenied();
        } catch (error) {
            if (error instanceof AccessDenied) throw new AccessDenied(error.code);
            if (error instanceof OperationInterrupted) throw new AccessDenied(error.reason === 'timeout' ? 'ACCESS_TIMEOUT' : 'ACCESS_CANCELLED');
            // Do not turn a broken policy into a permission denial or expose its details.
            throw new Error('Authorization policy failed.');
        }
    }
}

module.exports = { AccessPolicy, AccessDenied };
