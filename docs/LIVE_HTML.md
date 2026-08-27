# Redweb Live HTML

Live HTML is Redweb's decorator-first server-rendering layer. It uses the existing `HttpServer`, `SocketRoute`, admission, protocol, ordering, backpressure, and shutdown implementations rather than maintaining a second network stack.

This layer deliberately owns page concerns only: `@page`, `@state`, `@view`, and `@action`. It does not clone jax.on's `@get`/`@post` controller API. Continue using Redweb's `services` option for ordinary HTTP APIs; a unified controller decorator surface is a separate compatibility decision rather than hidden behavior in the rendering layer.

## Page model

Every page is a plain class registered with `@page(path, options)`. Extending `LivePage` remains compatible but is not required:

```ts
@page('/profile', { template: 'profile.html', css: 'profile.css' })
class ProfilePage {
  @state()
  displayName = 'Guest';
}
```

The decorators support both TypeScript's current standard decorator emit and the legacy `experimentalDecorators` ABI.

Pages use connection scope by default: each rendered browser page receives its own instance. `shared: true` creates one instance shared by every visitor to that page class and is appropriate for intentionally shared state such as a bounded chatroom history. `scope: 'shared'` remains available as the explicit equivalent.

`start(PageClass)` creates the Live HTML server. `@page()` captures its source directory when the module is evaluated, so colocated templates and styles work for unexported classes, CommonJS, ESM, and barrel exports without module scanning. Pass `templateRoot` explicitly only when page assets live in a different directory. Template and stylesheet traversal outside that root is rejected.

## Colocated CSS

Declare a stylesheet on the same decorator—no Express static middleware or manual `<link>` is required:

```ts
@page('/profile', { template: 'profile.html', css: 'profile.css' })
class ProfilePage {}
```

For composed styles, use `css: ['base.css', 'profile.css']`. Paths resolve from the same captured source directory as the template and cannot traverse outside it. Redweb reads each file once at startup, injects stylesheet links into the server-rendered document, and serves the CSS from a content-addressed URL with the correct content type and immutable caching. Remote URLs and static asset hosting remain under the application's control.

## Declarative HTML templates

Template files use the ordinary `.html` extension and contain no executable server code:

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

## Rendering collections

Keep collection data as an ordinary array and decorate the method that renders one item:

```ts
@state()
cards = [{ title: 'Sword' }, { title: 'Shield' }];

@view('cards')
card(item: { title: string }) {
    return html`<article class="card"><h2>${item.title}</h2></article>`;
}
```

Place the collection in the template with `<section rw-each="cards"></section>`. Redweb server-renders every item, escapes interpolated values, and replaces the collection contents when the array is reassigned. View methods are synchronous and must return an `HtmlFragment`. Arrays of fragments also compose naturally inside `html`, such as ``html`<div>${items.map(renderItem)}</div>` ``.

For a small, auditable safety model, ordinary `html` interpolations are allowed only in element text. Dynamic attributes and URLs require the explicit wrappers below. Interpolation in event handlers, inline styles, `srcdoc`, `srcset`, `<script>`, and `<style>` remains prohibited.

### Safe attributes and links

Dynamic document navigation remains explicit:

```ts
import { attribute, html, url } from 'redweb';

const section = { id: 'socket-server', name: 'SocketServer' };
const markup = html`
  <article id="${attribute(section.id)}">
    <a href="${url(`#${section.id}`)}">${section.name}</a>
  </article>
`;
```

`attribute()` accepts primitive values and is valid only inside a quoted non-URL attribute. `url()` is required for URL-bearing attributes such as `href`, `src`, and `action`; it permits relative URLs plus HTTP, HTTPS, mail, and telephone URLs, while rejecting control characters, protocol-relative URLs, and executable schemes. Both wrappers are escaped when rendered and are rejected in element text.

### Nested components and code

Plain functions returning `html` fragments are reusable server components. `each()` validates and joins arrays of those fragments, including nested lists:

```ts
import { codeBlock, each, html } from 'redweb';

const method = (entry: Method) => html`
  <section>
    <h3>${entry.name}</h3>
    <p>${entry.description}</p>
    ${codeBlock(entry.usage, { language: 'ts', label: 'TypeScript' })}
  </section>
`;

const reference = each(apiSections, section => html`
  <article>
    <h2>${section.name}</h2>
    ${each(section.methods, method)}
  </article>
`);
```

`codeBlock()` escapes strings by default. It may also receive an explicit `HtmlFragment`, allowing a server-side highlighter to compose safe token spans without accepting arbitrary HTML strings.

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

`start(PageClass, options)` accepts normal HTTP options plus the following Live HTML controls. `new LiveHtmlServer({ pages, ...options })` remains available for explicit composition:

- `pages`: non-empty array of decorated class constructors when using `LiveHtmlServer` directly.
- `templateRoot`: optional root for all `.html` templates and CSS files; when omitted, each page uses the source directory captured by its `@page()` decorator.
- `livePaths.css`: optional internal URL prefix for generated stylesheet routes; defaults to `/__redweb/css`.
- `sessionTtlMs`: pending/reconnect session lifetime; defaults to 30 seconds.
- `maxSessions`: maximum pending plus active page sessions; defaults to 1,000.
- `shutdownTimeoutMs`: maximum render/route drain time before forced cleanup; defaults to one second.
- `authenticate`: optional HTTP/WebSocket identity function for binding page sessions to an authenticated principal.
- `origins`: optional exact origin list or predicate for deployments behind a trusted proxy. Without it, Redweb requires a scheme-and-host match (`http`/WS or `https`/WSS).
- `livePaths`: optional `{ socket, client, runtime }` internal path overrides.

The internal paths and application page paths must be unique.

## Verification examples

- `examples/live-html/counter.ts` uses `@page()`, colocated CSS, and `@state()` to prove a connection-owned server timer can update browser state and is stopped on disconnect.
- `examples/live-html/chatroom.ts` uses `@page()`, colocated CSS, `@state()`, and `@action()` to prove bounded shared history, safe action invocation, safe HTML fragments, multi-client broadcasts, and reconnect behavior.
- `examples/live-html/cards.ts` uses a shared decorated page, `@view()`, and `rw-each` to prove server-rendered collection SSR, realtime replacement, and persistence across reloads and reconnects while the server is running.

Run the examples immediately with `npm run example:counter`, `npm run example:chatroom`, and `npm run example:cards`. Their checked-in JavaScript artifacts are generated from the decorated TypeScript sources, and every test and package build rejects stale output. The artifacts are launched unchanged by `tests/integration/live-html.integration.test.js` over real loopback HTTP and WebSocket connections. Run the focused gate with `npm run verify:live-html`, or the complete 100% coverage suite with `npm test`.

## Static pages and documentation export

Set `live: false` when a page needs server rendering but no realtime session:

```ts
import { exportStatic, page } from 'redweb';

@page('/docs', {
  template: 'docs.html',
  css: ['base.css', 'docs.css'],
  live: false,
  head: {
    title: 'Redweb API reference',
    description: 'HTTP, WebSocket, multiplayer, and Live HTML APIs.',
    canonical: 'https://example.com/docs',
    image: 'https://example.com/og.png',
    robots: 'index,follow',
  },
  cache: { maxAge: 300, staleWhileRevalidate: 3600 },
})
class DocsPage {}

await exportStatic(DocsPage, { outDir: 'dist' });
```

Non-live pages contain no page token or browser runtime. When served by `start()`, Redweb skips its WebSocket route, emits an ETag, honors `If-None-Match`, and applies the declared public cache policy. Interactive pages are always sent with `private, no-store`.

`exportStatic()` accepts one decorated class or an array. It requires `live: false`, maps `/` to `index.html` and `/docs` to `docs/index.html`, emits content-addressed CSS beside the pages, and returns frozen lists of written files. It never deletes or cleans the output directory.

The request exposed to `loading()` and `render()` is deliberately the portable `LivePageRequest` surface: `path`, `url`, `method`, `headers`, `params`, `query`, `body`, and `get(name)`. HTTP rendering supplies these from Express; static export supplies deterministic empty headers, parameters, query, and body values. Framework-specific Express request methods are not part of the page contract.
