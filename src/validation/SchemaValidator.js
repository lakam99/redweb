'use strict';

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
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) throw new TypeError('validationTimeoutMs must be an integer between 1 and 2147483647.');
        this.validateValue = standard.validate.bind(standard);
        this.timeoutMs = timeoutMs;
        Object.freeze(this);
    }

    async parse(input, signal) {
        if (signal?.aborted) throw new ValidationFailure('cancelled');
        let timer, abort;
        const started = performance.now();
        try {
            const interrupted = new Promise((_, reject) => {
                timer = setTimeout(() => reject(new ValidationFailure('timeout')), this.timeoutMs);
                abort = () => reject(new ValidationFailure('cancelled'));
                signal?.addEventListener('abort', abort, { once: true });
            });
            const work = Promise.resolve().then(async () => {
                if (signal?.aborted) throw new ValidationFailure('cancelled');
                const result = await this.validateValue(input);
                if (!result || typeof result !== 'object' || Array.isArray(result)) throw new ValidationFailure('validator');
                if (result.issues !== undefined) throw new ValidationFailure(Array.isArray(result.issues) ? 'input' : 'validator');
                if (!Object.hasOwn(result, 'value')) throw new ValidationFailure('validator');
                const value = await result.value;
                if (signal?.aborted) throw new ValidationFailure('cancelled');
                if (performance.now() - started >= this.timeoutMs) throw new ValidationFailure('timeout');
                return value;
            });
            return await Promise.race([work, interrupted]);
        } catch (error) {
            if (error instanceof ValidationFailure) throw error;
            throw new ValidationFailure('validator');
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
        }
    }
}

module.exports = { SchemaValidator, ValidationFailure };
