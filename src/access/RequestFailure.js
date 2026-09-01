'use strict';

const { STATUS_CODES } = require('http');
const AuthenticationFailure = require('./AuthenticationFailure');
const { AccessDenied } = require('./AccessPolicy');
const ActionInputError = require('../validation/ActionInputError');
const codes = require('./failure-codes.json');

const UPGRADE_REJECTION = Symbol('redweb.upgradeRejection');

/** Only allowlisted codes cross the HTTP upgrade boundary; never callback text. */
class RequestFailure extends Error {
    constructor(code) {
        const safeCode = typeof code === 'string' && Object.hasOwn(codes, code) ? code : 'ADMISSION_FAILED';
        const statusCode = codes[safeCode].status;
        super(safeCode.startsWith('AUTHENTICATION_') ? codes.AUTHENTICATION_REQUIRED.message : codes[safeCode].message || STATUS_CODES[statusCode]);
        this.code = safeCode;
        this.status = statusCode;
        this.rejection = Object.freeze({
            statusCode, statusText: STATUS_CODES[statusCode],
            headers: Object.freeze({ 'Redweb-Error': safeCode, 'Cache-Control': 'no-store' }),
        });
    }

    static from(error, fallback = 'ADMISSION_FAILED') {
        try {
            return new RequestFailure(error instanceof RequestFailure || error instanceof AuthenticationFailure || error instanceof AccessDenied || error instanceof ActionInputError
                ? error.code : fallback);
        } catch { return new RequestFailure(fallback); }
    }
}

module.exports = { RequestFailure, UPGRADE_REJECTION };
