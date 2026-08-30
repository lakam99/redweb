const { SchemaValidator } = require('../validation/SchemaValidator');
const { AccessPolicy } = require('../access/AccessPolicy');
const ActionInputError = require('../validation/ActionInputError');

class ActionDefinition {
    constructor(options = {}) {
        if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Action options must be an object.');
        if (Object.keys(options).some(key => !['input', 'validationTimeoutMs', 'authorize', 'authorizationTimeoutMs'].includes(key))) throw new TypeError('Unknown action option.');
        if (options.input === undefined && options.validationTimeoutMs !== undefined) throw new TypeError('Action validationTimeoutMs requires an input schema.');
        this.validator = options.input === undefined ? null : new SchemaValidator(options.input, options.validationTimeoutMs);
        this.authorization = new AccessPolicy(options.authorize, options.authorizationTimeoutMs);
        Object.freeze(this);
    }

    async arguments(args, context) {
        if (!this.validator && !this.authorization.authorize) return args;
        if (this.validator ? args.length !== 1 : args.length > 1) throw new ActionInputError();
        const controller = new AbortController();
        const signal = context?.signal;
        const socket = context?.socket;
        const abort = () => controller.abort();
        socket?.once('close', abort);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted || (socket && socket.readyState !== 1)) abort();
        try {
            let input = args[0];
            if (this.validator) input = await this.validator.parse(input, controller.signal);
            await this.authorization.check(Object.freeze({ ...context, signal: controller.signal }), input);
            return [input];
        } catch (error) {
            if (error.reason === 'input') throw new ActionInputError();
            if (error.reason === 'timeout') throw new ActionInputError('ACTION_VALIDATION_TIMEOUT');
            if (error.reason === 'cancelled') throw new ActionInputError('ACTION_CANCELLED');
            // ValidationFailure is already sanitized; policy failures preserve their own boundary.
            if (error.reason === 'validator') throw new Error('Action input validator failed.');
            throw error;
        } finally {
            socket?.off('close', abort);
            signal?.removeEventListener('abort', abort);
        }
    }
}

module.exports = { ActionDefinition, ActionInputError };
