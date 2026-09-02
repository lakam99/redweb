import type { BaseHandler, ProtocolMetadata, RedWebSocket } from 'redweb';
import type { ProtocolEnvelope, ProtocolErrorEnvelope, SendableSocket } from './client';

/** Structural Standard Schema v1 support; use an existing compatible validator library. */
export interface SocketSchema<Input = unknown, Output = Input> {
    readonly '~standard': {
        readonly version: 1;
        readonly validate: (input: unknown) =>
            { readonly value: Output; readonly issues?: undefined } | { readonly issues: readonly unknown[] } |
            Promise<{ readonly value: Output; readonly issues?: undefined } | { readonly issues: readonly unknown[] }>;
        readonly types?: { readonly input: Input; readonly output: Output };
    };
}

export type SocketSchemas = Readonly<Record<string, SocketSchema>>;
export type ContractInput<Schema extends SocketSchema> = NonNullable<Schema['~standard']['types']>['input'];
export type ContractOutput<Schema extends SocketSchema> = Awaited<NonNullable<Schema['~standard']['types']>['output']>;
export type ContractMessage<Schemas extends SocketSchemas> = {
    [Type in keyof Schemas & string]: ProtocolEnvelope<ContractOutput<Schemas[Type]>> & { type: Type };
}[keyof Schemas & string];

export interface ContractClient<Schemas extends SocketSchemas> {
    envelope<Type extends keyof Schemas & string>(type: Type, payload: ContractInput<Schemas[Type]>, metadata?: ProtocolMetadata):
        Promise<ProtocolEnvelope<ContractInput<Schemas[Type]>> & { type: Type }>;
    send<Type extends keyof Schemas & string>(type: Type, payload: ContractInput<Schemas[Type]>, metadata?: ProtocolMetadata): Promise<void>;
    parse(input: string | Uint8Array | ArrayBuffer | { data: string | Uint8Array | ArrayBuffer }):
        Promise<ContractMessage<Schemas> | ProtocolErrorEnvelope>;
}

export interface SocketContract<Schemas extends SocketSchemas> {
    readonly version: string;
    readonly types: readonly (keyof Schemas & string)[];
    readonly validationTimeoutMs: number;
    readonly protocol: { readonly versions: readonly string[] };
    parse<Type extends keyof Schemas & string>(type: Type, payload: unknown): Promise<ContractOutput<Schemas[Type]>>;
    handler<Type extends keyof Schemas & string>(type: Type, callback: (
        socket: RedWebSocket, payload: ContractOutput<Schemas[Type]>,
        message: ProtocolEnvelope<ContractOutput<Schemas[Type]>> & { type: Type },
    ) => unknown): new () => BaseHandler;
    client(socket: SendableSocket): ContractClient<Schemas>;
    send<Type extends keyof Schemas & string>(socket: RedWebSocket, type: Type, payload: ContractInput<Schemas[Type]>, metadata?: ProtocolMetadata): Promise<boolean>;
}

export function defineSocketContract<const Schemas extends SocketSchemas>(version: string, schemas: Schemas,
    options?: { validationTimeoutMs?: number }): SocketContract<Schemas>;
