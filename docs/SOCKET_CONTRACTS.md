# Shared socket contracts

Status: included in `redweb@0.13.5`.

A contract declares message payloads once. The same schema supplies runtime validation and inferred TypeScript types for senders and handlers. The URL still selects the route (`/match`), and the envelope's `type` selects an individual handler (`join`, `move`, `resume`). No socket decorators or second action dispatcher are required.

Start with `npx --yes redweb@0.13.5 init my-match --template socket`. The complete maintained example lives in [the socket recipe](../recipes/socket/README.md): [contract](../recipes/socket/contract.ts), [handlers](../recipes/socket/handlers.ts), [server](../recipes/socket/app.tsx), and [real-network tests](../recipes/socket/app.test.cjs).

Session ownership is separate from room fan-out. For authenticated group delivery,
see [room authorization](ROOM_AUTHORIZATION.md) and the complete
[shared page/private-room example](snippets/room-access.tsx).

## One schema, two sides

Import `defineSocketContract` from `redweb/contract` for a shared module, or from `redweb` in server-only code. The standalone entry does not import the HTTP server or Node socket listener. Browser consumers need a bundler capable of consuming the CommonJS package; this is not a native browser script URL or a React integration.

`defineSocketContract(version, schemas, options?)` accepts an object mapping message names to [Standard Schema v1](https://standardschema.dev/) validators. Zod is used by the starter, but is not a Redweb runtime dependency. Use your existing compatible schema library. The version must match the negotiated protocol version, and `error` is reserved for protocol errors. Contracts support 1–256 types, names up to 256 characters, and versions up to 64 characters.

- `contract.handler(type, callback)` returns a `BaseHandler` subclass accepted by `SocketRoute.handlers`. The callback receives `(socket, payload, message)` after validation. Payload and message types are inferred from the schema output. Register one handler per inbound type; declaring an outbound type does not expose a handler for it.
- `contract.protocol` supplies the immutable `{ versions: [version] }` route configuration. The route requires negotiation: a browser URL can use `?redwebVersion=1`. Contract handlers refuse a socket negotiated to a different version.
- `contract.client(socket)` wraps an existing browser or Node WebSocket-like object with `send(data)`. It neither opens the connection nor reconnects it. Wait for the socket to open before sending.
- `client.send(type, payload, metadata?)` validates and sends a JSON envelope. `client.envelope(...)` validates and returns the envelope without sending it. Senders use schema **input** types; receivers get schema **output** types. Metadata supports the existing `requestId` and `sequence` fields.
- `client.parse(frame)` decodes and validates a response. It accepts text, byte arrays, ArrayBuffers, or a message event containing them. The result is a type-discriminated message union or protocol error. Catch parse failures in asynchronous message listeners.
- `contract.send(serverSocket, type, payload, metadata?)` validates server output and uses the existing `sendEvent` transport path, preserving backpressure behavior. Its boolean result means the transport accepted the send, not that a peer received or acknowledged it.
- `contract.parse(type, unknownPayload)` runs validation directly without sending. It returns inferred output; this method alone does not JSON-serialize its argument.

## Validation and wire behavior

Socket payloads use JSON. Declare ISO strings rather than `Date` objects on the wire, and encode bigint values as strings. Top-level `undefined`, bigint, and cyclic values cannot be sent. JSON conversion occurs before sender validation, so the validator sees the representation that a receiver will actually get.

Sender validation uses an isolated copy. The transmitted payload remains the original JSON input snapshot even if a validator mutates its argument. Receiver validation produces transformed output for the application. Validators execute on both sending and receiving sides; use deterministic validators and avoid side effects such as writing to a database inside a transform.

Validation accepts asynchronous validators and awaits thenable outputs within the same error boundary/deadline. The default `validationTimeoutMs` is 5,000; configure a positive integer no greater than 2,147,483,647. Overdue validation is rejected, including synchronous work that finishes after its deadline. **This does not preempt synchronous JavaScript or cancel a validator's external work.** Validators are trusted application code, not a CPU sandbox. Keep expensive work out of validation and enforce transport payload/queue/rate limits separately.

Invalid inbound payloads never reach the handler callback. The peer receives sanitized `INVALID_PAYLOAD` and closes with code 1008. Validator diagnostics are not exposed because they may contain private data. Unknown inbound handler types retain `UNKNOWN_HANDLER`; incompatible versions are rejected during negotiation. Ordinary uncontracted routes keep their existing behavior.

Invalid output from `contract.send()` rejects locally. If that rejection escapes a handler, it is an application failure (`HANDLER_FAILED`, close 1011), not a client policy violation. Handle intentional application rejections explicitly if you want a recoverable protocol response; schema validation does not replace authentication, authorization, or game rules.

The match recipe uses private, in-memory bearer sessions solely to demonstrate join/move/resume. Read its security, restart, expiry, and scaling boundaries before adapting it.
