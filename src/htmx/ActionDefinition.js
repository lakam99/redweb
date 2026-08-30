const { SchemaValidator } = require('../validation/SchemaValidator');

class ActionInputError extends Error {
    constructor(code = 'ACTION_INVALID_INPUT') {
        super({
            ACTION_INVALID_INPUT: 'Action input is invalid. Check the form values and try again.',
            ACTION_VALIDATION_TIMEOUT: 'Action input validation timed out. The action was not run.',
            ACTION_CANCELLED: 'The connection closed before input validation completed. The action was not run.',
        }[code]);
        this.code = code;
    }
}

class ActionDefinition {
    constructor(options = {}) {
        if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Action options must be an object.');
        if (Object.keys(options).some(key => !['input', 'validationTimeoutMs'].includes(key))) throw new TypeError('Unknown action option.');
        if (options.input === undefined && options.validationTimeoutMs !== undefined) throw new TypeError('Action validationTimeoutMs requires an input schema.');
        this.validator = options.input === undefined ? null : new SchemaValidator(options.input, options.validationTimeoutMs);
        Object.freeze(this);
    }

    async arguments(args, context) {
        if (!this.validator) return args;
        if (args.length !== 1) throw new ActionInputError();
        const controller = new AbortController();
        const signal = context?.signal;
        const socket = context?.socket;
        const abort = () => controller.abort();
        socket?.once('close', abort);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted || (socket && socket.readyState !== 1)) abort();
        try {
            return [await this.validator.parse(args[0], controller.signal)];
        } catch (error) {
            if (error.reason === 'input') throw new ActionInputError();
            if (error.reason === 'timeout') throw new ActionInputError('ACTION_VALIDATION_TIMEOUT');
            if (error.reason === 'cancelled') throw new ActionInputError('ACTION_CANCELLED');
            // Schema bugs are server failures, not client mistakes; never disclose validator details.
            throw new Error('Action input validator failed.');
        } finally {
            socket?.off('close', abort);
            signal?.removeEventListener('abort', abort);
        }
    }
}

module.exports = { ActionDefinition, ActionInputError };
