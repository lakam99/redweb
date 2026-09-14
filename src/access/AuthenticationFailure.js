'use strict';
const codes = require('./failure-codes.json');

/** Safe authentication diagnostics shared by page and socket boundaries. */
class AuthenticationFailure extends Error {
    constructor(code = 'AUTHENTICATION_REQUIRED') {
        super(codes.AUTHENTICATION_REQUIRED.message);
        this.code = typeof code === 'string' && code.startsWith('AUTHENTICATION_') && Object.hasOwn(codes, code) ? code : 'AUTHENTICATION_FAILED';
        this.status = codes[this.code].status;
    }
}

module.exports = AuthenticationFailure;
