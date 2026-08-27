# Redweb Live HTML

Live HTML is Redweb's decorator-first server-rendering layer. It uses the existing `HttpServer`, `SocketRoute`, admission, protocol, ordering, backpressure, and shutdown implementations rather than maintaining a second network stack.

## Page model

Every page extends `LivePage` and is registered with `@page(path, options)`:

```ts
@page('/profile', { template: 'profile.htmx' })
class ProfilePage extends LivePage {
  @state()
  displayName = 'Guest';
}
```

Pages use connection scope by default: each rendered browser page receives its own instance. `scope: 'shared'` creates one instance shared by every visitor to that page class and is appropriate for intentionally shared state such as a bounded chatroom history.

`LiveHtmlServer` reads and caches template files during startup. Template paths are resolved inside `templateRoot`; traversal outside that root is rejected.

## Declarative `.htmx` templates

`.htmx` files contain HTML, not executable JavaScript:

```html
<h1>{{ displayName }}</h1>
<input rw-bind="displayName">
```

`{{ property }}` creates a text binding. During SSR it renders the current property value, and subsequent assignments to a decorated `@state()` property update only matching bindings.

Ordinary values are escaped during SSR and applied with `textContent` in the browser. The `html` tagged template returns an explicit `HtmlFragment`; its interpolations are escaped, while the resulting fragment may be applied as HTML.

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

`rw-click="action"` invokes an action without arguments. `rw-submit="action"` prevents the browser submission and passes the form fields as the first argument. `rw-bind="property"` sends input changes only when that property was declared with `@state({ writable: true })`.

Names such as `constructor`, `prototype`, and `__proto__` are rejected. Arbitrary methods and undeclared state cannot be reached through the Live HTML protocol.

## Lifecycle

Pages can implement these optional hooks:

- `loading(context)` runs before SSR and receives the Express request, params, query, and body.
- `connected(context)` runs after the page's authenticated socket connects and receives the socket and cancellation signal.
- `disconnected(context)` runs when that socket closes.
- `disposed()` runs once when a connection-scoped page expires or the server shuts down.

Timers and subscriptions created by a page should be owned by that page and stopped in `disconnected()` or `disposed()`. `dispose()` is idempotent.

HTTP rendering produces an unpredictable page ID. The browser presents it during a same-origin, versioned WebSocket upgrade. Pending and disconnected sessions expire, the registry is bounded by `maxSessions`, and a page ID cannot own two active sockets simultaneously.

## Browser transport

The injected module uses the published `redweb-client` package served by the same Redweb listener. It derives `ws:` or `wss:` from the current page, negotiates protocol version `1`, uses one socket per page, delegates DOM events at the document level, and opts into bounded reconnection attempts. It does not replay application actions.

## Options

`LiveHtmlServer` accepts normal HTTP options plus:

- `pages`: non-empty array of decorated `LivePage` constructors.
- `templateRoot`: root directory for `.htmx` templates; defaults to the current directory.
- `sessionTtlMs`: pending/reconnect session lifetime; defaults to 30 seconds.
- `maxSessions`: maximum pending plus active page sessions; defaults to 1,000.
- `livePaths`: optional `{ socket, client, runtime }` internal path overrides.

The internal paths and application page paths must be unique.

## Verification examples

- `examples/live-html/counter.js` proves a connection-owned server timer can update browser state and is stopped on disconnect.
- `examples/live-html/chatroom.js` proves bounded shared history, action invocation, safe HTML fragments, multi-client broadcasts, and reconnect behavior.

Both examples are launched unchanged by `tests/integration/live-html.integration.test.js` over real loopback HTTP and WebSocket connections. Run the focused gate with `npm run verify:live-html`, or the complete 100% coverage suite with `npm test`.
