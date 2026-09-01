const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const schema = require(path.join(root, 'src', 'ws', 'protocol-schema.json'));
const union = schema.errorCodes.map(code => `    | '${code}'`).join('\n');
const output = `// Generated from src/ws/protocol-schema.json by scripts/generate-protocol-types.js.
export type RedWebProtocolErrorCode =
${union};

export interface ProtocolMetadata {
    requestId?: string;
    sequence?: number;
}

export interface ProtocolEnvelope<T = unknown> extends ProtocolMetadata {
    v: string;
    type: string;
    payload: T;
}

export interface ProtocolErrorEnvelope extends ProtocolMetadata {
    v: string;
    type: 'error';
    error: { code: RedWebProtocolErrorCode | string; message: string };
}

export interface SendableSocket {
    send(data: string): unknown;
}

export class ProtocolClient {
    constructor(socket: SendableSocket, version: string);
    readonly socket: SendableSocket;
    readonly version: string;
    envelope<T>(type: string, payload: T, metadata?: ProtocolMetadata): ProtocolEnvelope<T>;
    send<T>(type: string, payload: T, metadata?: ProtocolMetadata): void;
    parse<T = unknown>(input: string | Uint8Array | ArrayBuffer | { data: string | Uint8Array | ArrayBuffer }): ProtocolEnvelope<T> | ProtocolErrorEnvelope;
}

export const ERROR_CODES: { readonly [Code in RedWebProtocolErrorCode]: Code };
`;
const target = path.join(root, 'client.d.ts');

if (process.argv.includes('--check')) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== output) {
        process.stderr.write('client.d.ts is stale; run npm run generate:protocol-types.\n');
        process.exitCode = 1;
    }
} else {
    fs.writeFileSync(target, output);
}
