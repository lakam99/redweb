'use strict';
const { BoundedOperation, OperationInterrupted } = require('../async/BoundedOperation');

class ValidationFailure extends Error {
    constructor(reason) {
        super('Schema validation did not complete successfully.');
        this.reason = reason;
    }
}

/** One bounded Standard Schema path for socket contracts and browser actions. */
class SchemaValidator {
    constructor(schema, timeoutMs = 5000) {
        const standard = schema?.['~standard'];
        if (standard?.version !== 1 || typeof standard.validate !== 'function') throw new TypeError('A Standard Schema v1 validator is required.');
        this.validateValue = standard.validate.bind(standard);
        this.boundary = new BoundedOperation(timeoutMs);
        Object.freeze(this);
    }

    async parse(input, signal) {
        try {
            return await this.boundary.run(async () => {
                const result = await this.validateValue(input);
                if (!result || typeof result !== 'object' || Array.isArray(result)) throw new ValidationFailure('validator');
                if (result.issues !== undefined) throw new ValidationFailure(Array.isArray(result.issues) ? 'input' : 'validator');
                if (!Object.hasOwn(result, 'value')) throw new ValidationFailure('validator');
                return await result.value;
            }, signal);
        } catch (error) {
            if (error instanceof ValidationFailure) throw error;
            if (error instanceof OperationInterrupted) throw new ValidationFailure(error.reason);
            throw new ValidationFailure('validator');
        }
    }
}

module.exports = { SchemaValidator, ValidationFailure };
