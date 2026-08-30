// Generated from src/ws/protocol-schema.json by scripts/generate-protocol-types.js.
export type RedWebProtocolErrorCode =
    | 'INVALID_MESSAGE'
    | 'INVALID_PAYLOAD'
    | 'UNKNOWN_HANDLER'
    | 'HANDLER_FAILED'
    | 'BINARY_UNSUPPORTED'
    | 'RATE_LIMITED'
    | 'QUEUE_FULL'
    | 'CAPACITY_REACHED'
    | 'INITIALIZATION_FAILED';

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
