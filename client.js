const schema = require('./src/ws/protocol-schema.json');
const { validateEnvelope } = require('./src/ws/protocol-validation');

const ERROR_CODES = Object.freeze(Object.fromEntries(schema.errorCodes.map(code => [code, code])));

function boundedString(value, name, maxLength) {
    if (typeof value !== 'string' || !value || value.length > maxLength) {
        throw new TypeError(`${name} must be a non-empty string of at most ${maxLength} characters.`);
    }
    return value;
}

class ProtocolClient {
    constructor(socket, version) {
        if (!socket || typeof socket.send !== 'function') throw new TypeError('socket must provide send(data).');
        this.socket = socket;
        this.version = boundedString(version, 'version', 64);
    }

    envelope(type, payload, metadata = {}) {
        const message = { v: this.version, type: boundedString(type, 'type', 256), payload };
        if (metadata.requestId !== undefined) {
            message.requestId = boundedString(metadata.requestId, 'requestId', 256);
        }
        if (metadata.sequence !== undefined) {
            if (!Number.isSafeInteger(metadata.sequence) || metadata.sequence < 0) {
                throw new TypeError('sequence must be a non-negative safe integer.');
            }
            message.sequence = metadata.sequence;
        }
        return message;
    }

    send(type, payload, metadata) {
        this.socket.send(JSON.stringify(this.envelope(type, payload, metadata)));
    }

    parse(input) {
        const raw = input && typeof input === 'object' && 'data' in input ? input.data : input;
        let serialized;
        if (typeof raw === 'string') serialized = raw;
        else if (raw instanceof ArrayBuffer) serialized = new TextDecoder().decode(new Uint8Array(raw));
        else if (ArrayBuffer.isView(raw)) serialized = new TextDecoder().decode(
            new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
        );
        else serialized = raw.toString();
        const message = JSON.parse(serialized);
        if (!validateEnvelope(message, this.version)) {
            throw new TypeError('Received an invalid Redweb protocol envelope.');
        }
        return message;
    }
}

module.exports = { ProtocolClient, ERROR_CODES };
