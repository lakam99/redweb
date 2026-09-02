'use strict';

const { isNativeError } = require('node:util/types');

// Never invoke user-defined coercion while preparing to release owned resources.
function verificationError(value) {
    if (isNativeError(value)) return value;
    const message = value !== null && (typeof value === 'object' || typeof value === 'function')
        ? 'Verification failed with a non-Error value.' : String(value);
    return new Error(message, { cause: value });
}

module.exports = { verificationError };
