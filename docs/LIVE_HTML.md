# Redweb Live HTML

Live HTML is Redweb's decorator-first server-rendering layer. It uses the existing `HttpServer`, `SocketRoute`, admission, protocol, ordering, backpressure, and shutdown implementations rather than maintaining a second network stack.

This layer deliberately owns page concerns only: `@page`, `@state`, and `@action`. It does not clone jax.on's `@get`/`@post` controller API. Continue using Redweb's `services` option for ordinary HTTP APIs; a unified controller decorator surface is a separate compatibility decision rather than hidden behavior in the rendering layer.

## Page model

Every page extends `LivePage` and is registered with `@page(path, options)`:

```ts
@page('/profile', { template: 'profile.htmx' })
class ProfilePage extends LivePage {
  @state()
  displayName = 'Guest';
}
```

The decorators support both TypeScript's current standard decorator emit and the legacy `experimentalDecorators` ABI.

Pages use connection scope by default: each rendered browser page receives its own instance. `scope: 'shared'` creates one instance shared by every visitor to that page class and is appropriate for intentionally shared state such as a bounded chatroom history.

`LiveHtmlServer` reads and caches template files during startup. Template paths are resolved inside `templateRoot`; traversal outside that root is rejected.

## Declarative `.htmx` templates

`.htmx` files contain HTML, not executable JavaScript:

```html
<h1>{{ displayName }}</h1>
<input rw-bind="displayName">
```

`{{ property }}` creates an inline text binding. For context-safe container updates, bind an existing element; this is especially useful when a value contains several list or table children:

```html
<ul data-rw-state="messages"></ul>
```

During SSR Redweb fills the bound element with the current property value, and subsequent assignments to a decorated `@state()` property update the same element.

Ordinary values are escaped during SSR and applied with `textContent` in the browser. The `html` tagged template returns an explicit `HtmlFragment`; its interpolations are escaped, while the resulting fragment may be applied as HTML.

For a small, auditable safety model, `html` interpolations are allowed only in element text. Dynamic attributes, URLs, `<script>`, and `<style>` content are rejected; construct those values outside HTML or expose them through a purpose-built static template instead.

State observation is deliberately shallow. Assigning a new value publishes an update; mutating a nested object or array in place does not. Reassign after nested changes:

```ts
this.players = [...this.players, player];
```

## Browser actions and input

Only methods decorated with `@action()` may be invoked by the browser:

```ts
@action()
save(form: { displayName: string }) {
  this.displayName = form.displayName;
}
```

```html
<form rw-submit="save">
  <input name="displayName">
  <button>Save</button>
</form>
```

`rw-click="action"` prevents default navigation and invokes an action without arguments. `rw-submit="action"` prevents submission, passes form fields as the first argument, preserves duplicate field names as arrays, and resets only after the server acknowledges success. `rw-bind="property"` sends text values or checkbox state only when that property was declared with `@state({ writable: true })`.

The document emits `redweb:connection` events as transport state changes and `redweb:error` events when an interaction fails. A bounded queue covers interaction during initial connection; actions are request/response operations and are not replayed during reconnect.

Names such as `constructor`, `prototype`, and `__proto__` are rejected. Arbitrary methods and undeclared state cannot be reached through the Live HTML protocol.

## Lifecycle

Pages can implement these optional hooks:

- `loading(context)` runs before SSR and receives the Express request, params, query, body, and shutdown `signal`.
- `connected(context)` runs after the page's authenticated socket connects and receives the socket and cancellation signal.
- `disconnected(context)` runs when that socket closes and may be asynchronous.
- `disposed()` runs once when a connection-scoped page expires or the server shuts down and may be asynchronous.

Timers and subscriptions created by a page should be owned by that page and stopped in `disconnected()` or `disposed()`. `dispose()` is idempotent.

Shutdown aborts the render signal and waits up to `shutdownTimeoutMs` (one second by default) for active `loading()` and `render()` hooks. If a hook ignores cancellation, Redweb disposes its page, force-closes the affected HTTP connection, completes the remaining cleanup phases, and then reports the timeout.

HTTP rendering produces an unpredictable page ID. The browser presents it during a same-origin, versioned WebSocket upgrade. Pending and disconnected sessions expire, the registry is bounded by `maxSessions`, and a page ID cannot own two active sockets simultaneously.

For authenticated pages, provide `authenticate(request)`. It runs for both the HTTP render and WebSocket upgrade and must return the same stable primitive identity (commonly a user ID) for both requests. A missing, rejected, changed, or object identity is denied, preventing a copied page token from crossing authentication boundaries. The identity is available as `context.principal` in page hooks and actions.

## Browser transport

The injected module uses the published `redweb-client` package served by the same Redweb listener. It derives `ws:` or `wss:` from the current page, negotiates protocol version `1`, uses one socket per page, delegates DOM events at the document level, and opts into bounded reconnection attempts. Every initial connection and reconnect receives an authoritative state snapshot. Supplying the normal `ssl` option runs both the page and socket over HTTPS/WSS.

## Options

`LiveHtmlServer` accepts normal HTTP options plus:

- `pages`: non-empty array of decorated `LivePage` constructors.
- `templateRoot`: root directory for `.htmx` templates; defaults to the current directory.
- `sessionTtlMs`: pending/reconnect session lifetime; defaults to 30 seconds.
- `maxSessions`: maximum pending plus active page sessions; defaults to 1,000.
- `shutdownTimeoutMs`: maximum render/route drain time before forced cleanup; defaults to one second.
- `authenticate`: optional HTTP/WebSocket identity function for binding page sessions to an authenticated principal.
- `origins`: optional exact origin list or predicate for deployments behind a trusted proxy. Without it, Redweb requires a scheme-and-host match (`http`/WS or `https`/WSS).
- `livePaths`: optional `{ socket, client, runtime }` internal path overrides.

The internal paths and application page paths must be unique.

## Verification examples

- `examples/live-html/counter.ts` uses `@page()` and `@state()` to prove a connection-owned server timer can update browser state and is stopped on disconnect.
- `examples/live-html/chatroom.ts` uses `@page()`, `@state()`, and `@action()` to prove bounded shared history, safe action invocation, safe HTML fragments, multi-client broadcasts, and reconnect behavior.

Run the examples with `npm run example:counter` and `npm run example:chatroom`. Their TypeScript sources are compiled before execution and launched unchanged by `tests/integration/live-html.integration.test.js` over real loopback HTTP and WebSocket connections. Run the focused gate with `npm run verify:live-html`, or the complete 100% coverage suite with `npm test`.
