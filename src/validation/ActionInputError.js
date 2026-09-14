'use strict';
const codes = require('../access/failure-codes.json');

class ActionInputError extends Error {
    constructor(code = 'ACTION_INVALID_INPUT') {
        const safeCode = typeof code === 'string' && code.startsWith('ACTION_') && Object.hasOwn(codes, code) ? code : 'ACTION_INVALID_INPUT';
        super(codes[safeCode].message);
        this.code = safeCode;
    }
}

module.exports = ActionInputError;
