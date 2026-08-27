const { Buffer } = require('buffer');
const schema = require('./protocol-schema.json');
const { validateEnvelope } = require('./protocol-validation');

const PROTOCOL_CONTEXT = Symbol('redweb.protocolContext');
const PROTOCOL_REJECTION = Symbol('redweb.protocolRejection');

const ERROR_CODES = Object.freeze(Object.fromEntries(schema.errorCodes.map(code => [code, code])));

function nonEmptyBoundedString(value, name, maxLength = 64) {
    if (typeof value !== 'string' || !value || value.length > maxLength) {
        throw new TypeError(`\`${name}\` must be a non-empty string of at most ${maxLength} characters.`);
    }
    return value;
}

class ProtocolPolicy {
    constructor(options) {
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
            throw new TypeError('`protocol` must be an object.');
        }
        const {
            versions,
            required = true,
            queryParameter = 'redwebVersion',
            header = 'x-redweb-version',
            binary,
        } = options;
        if (!Array.isArray(versions) || versions.length === 0 || versions.length > 16) {
            throw new TypeError('`protocol.versions` must contain between 1 and 16 versions.');
        }
        this.versions = versions.map(version => nonEmptyBoundedString(version, 'protocol version'));
        if (new Set(this.versions).size !== this.versions.length) {
            throw new TypeError('`protocol.versions` entries must be unique.');
        }
        if (typeof required !== 'boolean') throw new TypeError('`protocol.required` must be a boolean.');
        this.queryParameter = nonEmptyBoundedString(queryParameter, 'protocol.queryParameter');
        this.header = nonEmptyBoundedString(header, 'protocol.header').toLowerCase();
        this.required = required;
        this.binary = this.validateBinary(binary);
    }

    validateBinary(binary) {
        if (binary === undefined || binary === false) return null;
        if (!binary || typeof binary !== 'object' || Array.isArray(binary)) {
            throw new TypeError('`protocol.binary` must be an object.');
        }
        if (typeof binary.encode !== 'function' || typeof binary.decode !== 'function') {
            throw new TypeError('`protocol.binary` requires `encode` and `decode` functions.');
        }
        const maxBytes = binary.maxBytes ?? 64 * 1024;
        if (!Number.isInteger(maxBytes) || maxBytes < 1) {
            throw new TypeError('`protocol.binary.maxBytes` must be a positive integer.');
        }
        return { encode: binary.encode, decode: binary.decode, maxBytes };
    }

    negotiate(request) {
        let requested;
        try {
            const host = request.headers?.host || 'localhost';
            requested = new URL(request.url || '/', `http://${host}`).searchParams.get(this.queryParameter)
                || request.headers?.[this.header];
        } catch {
            return this.reject(request, 'Malformed protocol negotiation request.');
        }
        if (Array.isArray(requested)) requested = requested[0];
        const version = requested || (this.required ? null : this.versions[0]);
        if (!version || !this.versions.includes(version)) {
            return this.reject(request, 'A supported protocol version is required.');
        }
        request[PROTOCOL_CONTEXT] = Object.freeze({ version });
        return true;
    }

    reject(request, message) {
        request[PROTOCOL_REJECTION] = {
            statusCode: 426,
            statusText: 'Upgrade Required',
            headers: { 'Redweb-Versions': this.versions.join(', ') },
            message,
        };
        return false;
    }

    envelope(version, type, payload, metadata = {}) {
        nonEmptyBoundedString(type, 'protocol event type', 256);
        const envelope = { v: version, type, payload };
        if (metadata.requestId !== undefined) {
            envelope.requestId = nonEmptyBoundedString(metadata.requestId, 'protocol requestId', 256);
        }
        if (metadata.sequence !== undefined) {
            if (!Number.isSafeInteger(metadata.sequence) || metadata.sequence < 0) {
                throw new TypeError('`protocol sequence` must be a non-negative safe integer.');
            }
            envelope.sequence = metadata.sequence;
        }
        return envelope;
    }

    error(version, code, message, metadata = {}) {
        nonEmptyBoundedString(code, 'protocol error code', 256);
        nonEmptyBoundedString(message, 'protocol error message', 1024);
        const envelope = this.envelope(version, 'error', undefined, metadata);
        delete envelope.payload;
        envelope.error = { code, message };
        return envelope;
    }

    validateEnvelope(message, version) {
        return validateEnvelope(message, version);
    }

    async decodeBinary(buffer, context) {
        if (!this.binary || buffer.length > this.binary.maxBytes) return null;
        return this.binary.decode(buffer, context);
    }

    async encodeBinary(value, context) {
        if (!this.binary) return null;
        const encoded = await this.binary.encode(value, context);
        if (!(Buffer.isBuffer(encoded) || encoded instanceof Uint8Array || encoded instanceof ArrayBuffer)) {
            throw new TypeError('`protocol.binary.encode` must return Buffer, Uint8Array, or ArrayBuffer.');
        }
        const buffer = Buffer.from(encoded);
        return buffer.length <= this.binary.maxBytes ? buffer : null;
    }
}

module.exports = { ProtocolPolicy, PROTOCOL_CONTEXT, PROTOCOL_REJECTION, ERROR_CODES };
