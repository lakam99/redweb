'use strict';

const { BaseHandler } = require('./BaseHandler');
const { ProtocolClient } = require('../../client');
const { ContractValidationError, InboundContractValidationError } = require('./ContractValidationError');
const { SchemaValidator } = require('../validation/SchemaValidator');

function boundedName(value, label) {
    if (typeof value !== 'string' || !value || value.length > 256) throw new TypeError(`${label} must be a non-empty string of at most 256 characters.`);
    return value;
}

async function validatedWirePayload(contract, type, payload) {
    let serialized, input;
    try {
        serialized = JSON.stringify(payload);
        input = JSON.parse(serialized);
    }
    catch { throw new ContractValidationError(); }
    await contract.parse(type, input);
    // A validator may mutate its argument. Always send the original input snapshot.
    return JSON.parse(serialized);
}

class ContractClient {
    constructor(contract, socket) {
        this.contract = contract;
        this.protocol = new ProtocolClient(socket, contract.version);
    }

    async envelope(type, payload, metadata) {
        const input = await validatedWirePayload(this.contract, type, payload);
        // Validate the input, but keep its wire representation. Receiver-side transforms run exactly once.
        return this.protocol.envelope(type, input, metadata);
    }

    async send(type, payload, metadata) {
        this.protocol.socket.send(JSON.stringify(await this.envelope(type, payload, metadata)));
    }

    async parse(input) {
        const message = this.protocol.parse(input);
        if (message.type === 'error') return message;
        return { ...message, payload: await this.contract.parse(message.type, message.payload) };
    }
}

class SocketContract {
    #validators;

    constructor(version, schemas, options) {
        boundedName(version, 'Contract version');
        if (version.length > 64) throw new TypeError('Contract version must be at most 64 characters.');
        if (!schemas || typeof schemas !== 'object' || Array.isArray(schemas)) throw new TypeError('Contract schemas must be an object.');
        if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Contract options must be an object.');
        const timeout = options.validationTimeoutMs ?? 5000;
        const entries = Object.entries(schemas);
        if (!entries.length || entries.length > 256) throw new TypeError('A socket contract must define between 1 and 256 message types.');
        this.#validators = new Map(entries.map(([type, schema]) => {
            boundedName(type, 'Contract message type');
            if (type === 'error') throw new TypeError('The error message type is reserved by the protocol.');
            return [type, new SchemaValidator(schema, timeout)];
        }));
        this.version = version;
        this.validationTimeoutMs = timeout;
        this.types = Object.freeze(entries.map(([type]) => type));
        this.protocol = Object.freeze({ versions: Object.freeze([version]) });
        Object.freeze(this);
    }

    async parse(type, payload) {
        const validate = this.#validators.get(type);
        if (!validate) throw new ContractValidationError('UNKNOWN_HANDLER');
        try {
            return await validate.parse(payload);
        } catch {
            // Validator details can contain application data. Never expose them as protocol errors.
            throw new ContractValidationError();
        }
    }

    handler(type, callback) {
        if (!this.#validators.has(type)) throw new TypeError('Handler message type is not defined in the contract.');
        if (typeof callback !== 'function') throw new TypeError('A contract handler requires a callback.');
        const contract = this;
        return class ContractHandler extends BaseHandler {
            constructor() { super(type); }
            async handleMessage(socket, message) {
                if (socket.context?.protocol?.version !== contract.version) throw new TypeError('The route must negotiate this contract version before handling messages.');
                let payload;
                try { payload = await contract.parse(type, message.payload); }
                catch { throw new InboundContractValidationError(); }
                return super.handleMessage(socket, { ...message, payload });
            }
            onMessage(socket, message) { return callback(socket, message.payload, message); }
        };
    }

    client(socket) { return new ContractClient(this, socket); }

    async send(socket, type, payload, metadata) {
        if (socket.context?.protocol?.version !== this.version) throw new TypeError('The socket must negotiate this contract version before sending events.');
        const input = await validatedWirePayload(this, type, payload);
        return socket.sendEvent(type, input, metadata);
    }
}

function defineSocketContract(version, schemas, options = {}) {
    return new SocketContract(version, schemas, options);
}

module.exports = { defineSocketContract };
