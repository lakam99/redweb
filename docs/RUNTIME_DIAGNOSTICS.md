# Understand failures before retrying

Status: published in `redweb@0.13.0`.

Authentication identifies a visitor. Authorization decides what that visitor may do. Validation checks an input's shape. An application failure means server code or a dependency failed; it is not evidence that the visitor supplied bad credentials.

Redweb keeps these boundaries separate. It does not automatically retry failed actions, undo application writes, or guarantee exactly-once delivery.

## Reading a failed connection

Before a WebSocket opens, Redweb sends an HTTP rejection with a fixed `Redweb-Error` header and `Cache-Control: no-store`. There is no error body and no callback exception text. Node's `ws` client can inspect it:

```typescript
import WebSocket from 'ws';

const socket = new WebSocket('ws://127.0.0.1:8181/match?redwebVersion=1');
socket.on('unexpected-response', (_request, response) => {
    console.error(response.statusCode, response.headers['redweb-error']);
    response.resume();
    socket.terminate();
});
socket.on('error', () => console.error('Connection did not open.'));
```

This is a Node diagnostic example, not browser code. Native browser WebSocket JavaScript cannot inspect handshake status or response headers. Use the browser network inspector during development and your application's normal HTTP sign-in/status flow for user-facing guidance. A generic browser socket error alone cannot distinguish rejected credentials from networking, origin, protocol, or server failures. Proxies may replace or strip responses.

| Code | HTTP status | Meaning and next step |
| --- | --- | --- |
| `REQUEST_INVALID` | 400 | The upgrade request cannot be represented safely. Correct the request or server middleware. |
| `AUTHENTICATION_REQUIRED` | 401 | Identity was rejected, or the page session is missing, expired, already attached, or mismatched. Obtain valid credentials/a fresh page; do not retry the same rejected credentials in a loop. |
| `ORIGIN_DENIED` | 403 | Browser origin was missing or not allowed. Correct the trusted-origin configuration; do not disable origin checks to hide the failure. |
| `ACCESS_DENIED` | 403 | The page permission policy denied access. Obtain permission before retrying. |
| `PLACEMENT_DENIED` | 403 | Placement explicitly rejected the connection. Follow application placement rules. |
| `PROTOCOL_UNSUPPORTED` | 426 | Negotiation requires a supported version. `Redweb-Versions` lists supported versions; use a compatible client and contract. |
| `AUTHENTICATION_FAILED` | 500 | The rendered-page identity callback failed. Investigate the application or identity provider. |
| `ADMISSION_FAILED` | 500 | Admission/origin/placement code, a page upgrade policy, or the upgrade pipeline failed. This is not a bad-password response. |
| `PLACEMENT_INVALID` | 500 | Placement returned an unsafe or disallowed redirect. Repair the server-side placement result/allowlist. |
| `AUTHENTICATION_TIMEOUT`, `ACCESS_TIMEOUT`, `ADMISSION_TIMEOUT` | 503 | The relevant stage exceeded its deadline. Check the dependency and use bounded reconnect backoff only when appropriate. |
| `AUTHENTICATION_CANCELLED`, `ACCESS_CANCELLED`, `ADMISSION_CANCELLED` | 503 | The relevant lifetime ended. Start a new permitted attempt rather than reusing a revoked page/session. A disconnected peer may receive no response. |
| `ACCESS_CAPACITY`, `ADMISSION_CAPACITY` | 503 | Bounded authorization/admission work or connection capacity is exhausted. Wait and back off; do not retry in a tight loop. |
| `SERVER_DRAINING`, `ROUTE_UNAVAILABLE` | 503 | The service is draining or the route is not ready. Reconnect to a ready instance according to the application's routing policy. |

Accepted placement redirects remain HTTP 307 with the validated `Location`, no error code, and no-store caching. A redirect is not proof that the destination will admit the same credentials. Never forward credentials to arbitrary redirect destinations.

Raw route authentication preserves its existing contract: only literal `false` rejects the identity; application-owned principal objects remain supported. Page authentication requires its documented primitive identity. Do not rely on a raw callback returning `undefined` to deny access.

## Page requests

Page HTTP failures return `{ "error": { "code": "...", "message": "..." } }` with `Cache-Control: private, no-store`. Authentication and authorization use the categories above. `PAGE_CAPACITY` is 503; `PAGE_FAILED` is a sanitized 500 for construction, loading, or rendering failures, including public pages. Unknown application error text and Express development stacks are not returned. Typed errors are reconstructed from the fixed catalogue rather than trusting mutable status/message fields.

If the response is already closed, Redweb does not write another response. If headers were already sent by application middleware, the connection is closed instead of appending a misleading JSON error. Redweb cannot retract content your middleware already sent or sanitize arbitrary HTTP routes you mount yourself.

## Actions and established sockets

Once connected, failures use the existing protocol error envelope and request ID when available. Unversioned room-entry failures use `{ code, error }`; other legacy unversioned failures retain `{ error }` without a structured code. The client may still disconnect before receiving the response. Typed permission/input errors are normalized again at the final send boundary, so application catch/rethrow code cannot accidentally expose appended private exception text.

| Boundary | Diagnostic | What Redweb guarantees |
| --- | --- | --- |
| Action input | `ACTION_INVALID_INPUT` | The action method was not invoked. Correct the form values. |
| Action input lifetime | `ACTION_VALIDATION_TIMEOUT`, `ACTION_CANCELLED` | Validation did not complete within its lifetime; the action method was not invoked. |
| Action/room permission | `ACCESS_DENIED`, `ACCESS_TIMEOUT`, `ACCESS_CANCELLED`, `ACCESS_CAPACITY` | That failed permission check did not commit room entry or invoke the guarded action. Existing memberships and prior actions are separate. These responses do not inherently close the socket. |
| Browser send | `ACTION_OFFLINE`, `ACTION_CAPACITY` | This browser action was not sent. Reconnect or wait before deliberately trying again. |
| Socket envelope/contract | `INVALID_MESSAGE`, `INVALID_PAYLOAD`, `UNKNOWN_HANDLER` | The requested handler callback was not invoked. Correct the message/contract. These paths generally close the connection; they are not automatic retry signals. |
| Application/validator/output bug | `HANDLER_FAILED` | The operation failed; application effects may already have happened. Inspect authoritative state before resubmitting. |

An input validator, identity lookup, or permission callback can itself perform external work. A “method was not invoked” result does not promise those callbacks had no side effects. Keep validators and policies free of writes where practical; use explicit idempotency keys and durable transactions for application operations that may be retried.

Those non-invocation guarantees describe failures produced by Redweb's validation and permission gates. They do not apply to application code deliberately throwing an internal typed error or sending the same diagnostic after its own work has begun.

## Deadlines, cancellation, and disclosure limits

Raw admission shares the bounded-operation implementation used by other policy/validation paths. It checks the deadline between origin, identity, and placement stages, so a timed-out or cancelled stage cannot start the next stage after eventually returning. It retains its actual evaluation promise in admission accounting until that evaluation settles. Synchronous JavaScript cannot be interrupted; a callback that blocks the event loop delays timeout observation, but an overdue result cannot admit a connection.

Page identity and permission evaluation also have their own deadlines and session/revocation signals. The outer raw-admission deadline does not forcibly stop those nested callbacks or their external I/O. Cancellation of observation is not cancellation of database/network side effects. Honor available signals, set downstream timeouts, and never treat this as a sandbox for untrusted callback code.

Default handler responses are sanitized. Raw routes deliberately configured with `exposeErrors: true` opt into disclosing handler exception text; do not enable that in production. Existing application/logger hooks may receive original errors and client metadata, so logs require access controls and redaction. The new upgrade pipeline logs only fixed admission failure details, and a throwing logger cannot prevent upgrade rejection or reservation cleanup.

See [private rooms](ROOM_AUTHORIZATION.md), [socket contracts](SOCKET_CONTRACTS.md), and [operating socket services](MULTIPLAYER_OPERATIONS.md) for their complete limits. A successful `send` means accepted by the local transport, not acknowledged application delivery.
