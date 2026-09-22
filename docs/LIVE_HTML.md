# Redweb Live HTML

Live HTML is Redweb's decorator-first server-rendering layer. It uses the existing `HttpServer`, `SocketRoute`, admission, protocol, ordering, backpressure, and shutdown implementations rather than maintaining a second network stack.

## TSX rendering

New pages can return TSX directly. Run `npx redweb init` for a starter project, or extend `redweb/tsconfig.json` from an existing project's root `tsconfig.json`. The preset makes builds and editors use Redweb's dependency-free JSX runtime consistently:

```json
{
  "extends": "redweb/tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

Redweb renders TSX immediately to `HtmlFragment` values:

```tsx
import { action, defineApp, page, state } from 'redweb';
import type { Child } from 'redweb/jsx-runtime';

function Panel({ title, children }: { title: string; children?: Child }) {
  return <section class="panel"><h2>{title}</h2>{children}</section>;
}

@page('/counter', { css: 'counter.css' })
class CounterPage {
  @state() count = 0;

  @action()
  increment() { this.count += 1; }

  render() {
    return (
      <Panel title="Server counter">
        <button rw-click="increment">
          Count {this.count}
        </button>
      </Panel>
    );
  }
}

const app = defineApp({ pages: [CounterPage] });
app.run();
```

Intrinsic elements, fragments (`<>...</>`), nested readonly arrays, and synchronous function components are supported. Strings, numbers, and attributes are escaped once; null, undefined, and boolean children render nothing. Safe existing `html` fragments compose in either direction.

JSX remains a server renderer rather than a React compatibility layer: no React hooks, refs, hydration, client event functions, or object-style API. Live sessions retain owner-level HTML snapshots and state dependencies for automatic updates; static pages retain no reactive tree and ship no runtime. Use `rw-click`, `rw-submit`, `rw-bind`, and the other Redweb directives for server actions, and use `@page({ css })` or external assets for styling and scripts. Unsafe URL protocols, `on*`, dynamic `style`, `srcdoc`, `srcset`, children on void elements, and executable `<script>` or `<style>` children are rejected.

## Automatic reactive TSX

A decorated state read during `render()` subscribes that page or class component to the state. Changing the property rerenders the affected owners, batches synchronous assignments, and sends changed HTML only. Ordinary expressions such as `{this.count * 2}`, conditional branches, and `.map()` need no state-binding attributes. Function components participate in their enclosing owner's render; use a class `@component()` for an independently stateful boundary.

```tsx
render() {
  return <ul>{this.cards.map(card => (
    <li key={card.id}><input name="title" value={card.title} /></li>
  ))}</ul>;
}
```

Keys must be stable strings or numbers (at most 256 characters), unique among siblings. Keyed elements and fragments preserve their DOM nodes during moves. Unchanged server values preserve unsent input; a changed server `value` or `checked` attribute intentionally updates the control. Focus and text selection are preserved when their node survives. Removing a keyed item removes its local input state. Unkeyed repeated items do not promise identity across reordering.

Select controls preserve surviving selected options whose values are unchanged, even when several options have the same value. Replaced options fall back to available matching values without selecting every duplicate. Changed server-authored `selected` defaults intentionally update the selection; reordering the same keyed defaults does not discard a different unsent choice. Use stable option keys when option identity matters.

Updates use `redweb:patch` with owner patches and any explicit state bindings in one frame. Existing non-TSX pages continue using `redweb:state`. Explicit `data-rw-state` and `rw-bind` directives can coexist with TSX; do not combine a direct binding with a different derived expression on the same element. The runtime reconciles HTML rather than executing browser components. Internal HTML comments delimit components/keys without introducing layout wrappers, including inside table bodies and selects.

State changes remain assignment-driven. Mutating an array or object in place is not observed; assign a new value. `render()` must be side-effect-free with respect to decorated state (writes during rendering throw). Loading, connections, timers, and persistence belong in lifecycle hooks or actions, which are not rerun for UI patches. Hiding an element is not an authorization boundary for its actions.

Each HTTP/page session retains its own request context and snapshots, even when the underlying page state is shared. Reconnect sends a current root snapshot. Disconnect discards unfinished update results; session disposal aborts its render signal and releases snapshots. Async rendering has a five-second limit, and a snapshot tree is bounded to 1 MiB of retained HTML and 1,024 owners. These bounds include nested snapshots, not just visible document size. As with ordinary JavaScript, synchronous application code cannot be preempted; async work should honor cancellation and avoid unbounded operations. A failed update is logged and closes the affected connection instead of emitting partial HTML.

This layer deliberately owns page concerns only: `@page`, `@state`, `@view`, and `@action`. It does not clone jax.on's `@get`/`@post` controller API. Use `defineApp({ httpServices })` for ordinary HTTP endpoints; application lifecycle `services` is a separate option. Typed socket handlers can also bind directly to TSX on [socket-bound pages](SOCKET_PAGES.md).

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

Use `defineApp({ pages: [PageClass] })` and `app.run()` for application startup. `start(PageClass)` remains a lower-level convenience. `@page()` captures its source directory when the module is evaluated, so colocated templates and styles work for unexported classes, CommonJS, ESM, and barrel exports without module scanning. Pass `templateRoot` explicitly only when page assets live in a different directory. Template and stylesheet traversal outside that root is rejected.

## Colocated CSS

Declare a stylesheet on the same decorator—no Express static middleware or manual `<link>` is required:

```ts
@page('/profile', { template: 'profile.html', css: 'profile.css' })
class ProfilePage {}
```

For composed styles, use `css: ['base.css', 'profile.css']`. Paths resolve from the same captured source directory as the template and cannot traverse outside it. Redweb reads each file once at startup, injects stylesheet links into the server-rendered document, and serves the CSS from a content-addressed URL with the correct content type and immutable caching. Remote URLs and static asset hosting remain under the application's control.

## Alternative: declarative HTML templates

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

## Template collections (TSX can use map directly)

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

For a small, auditable safety model, primitive values may be interpolated into quoted attributes. URL-bearing attributes additionally pass through Redweb's safe-URL policy. The explicit `attribute()` and `url()` wrappers remain supported when they improve intent. Interpolation in event handlers, inline styles, `srcdoc`, `srcset`, `<script>`, and `<style>` remains prohibited.

## Reusable components

For stateless snippets, use an ordinary TSX function:

```tsx
function Badge({ label }: { label: string }) {
  return <strong class="badge">{label}</strong>;
}
```

Function components are synchronous and return an `HtmlFragment` (the value produced by TSX) or a readonly array of `HtmlFragment` values. The `component(fn)` wrapper remains available for template composition; it is not required for TSX functions. Use a decorated class when a component needs state, actions, or lifecycle hooks.

Decorate a plain class with `@component()` to give a reusable HTML snippet its own server state, actions, and lifecycle. Store component instances in page fields and interpolate them like any other safe HTML fragment:

<!-- source: docs/snippets/components.tsx -->

The field path is the component's public protocol namespace, so both counters can expose `count` and `increment` without collisions. Browser events carry that visible namespace and the server resolves it through its component registry; client-supplied object paths are never evaluated. It is routing metadata, not an authorization boundary—component actions must enforce the same application authorization as page actions. Components may contain other decorated components, and state updates retain the complete nested namespace.

Component instances are owned by exactly one construction-time page or component field. Their synchronous `render(context)` method may return a safe `HtmlFragment` or a declarative template string; request context is propagated per render, including on concurrent shared pages. Components receive the same `loading`, `connected`, `disconnected`, and `disposed` hooks as their page, including the authenticated principal and cancellation signal where applicable. Disposal starts every child and owner cleanup together and preserves every settled failure, so one broken sibling cannot starve later hooks.

Redweb scopes only elements that carry a state, binding, or action directive; it does not add layout wrappers or inline styles. Components therefore remain valid in restricted contexts such as tables and selects and work with strict `style-src` policies.

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

`attribute()` accepts primitive values and is valid only inside a quoted non-URL attribute. `url()` explicitly brands URL-bearing attributes such as `href`, `src`, and `action`; direct string values receive the same validation. Redweb permits relative URLs plus HTTP, HTTPS, mail, and telephone URLs, while rejecting control characters, protocol-relative URLs, and executable schemes. Both wrappers are escaped when rendered and are rejected in element text.

### Nested components and code

Use ordinary TSX functions and `map` for nested presentation. `codeBlock` returns a safe fragment that composes directly with TSX:

```tsx
import { codeBlock } from 'redweb';

type MethodInfo = { name: string; description: string; usage: string };

function Method({ name, description, usage }: MethodInfo) {
  return <section><h3>{name}</h3><p>{description}</p>
    {codeBlock(usage, { language: 'ts', label: 'TypeScript' })}
  </section>;
}

// apiSections is the application's documentation data.
const reference = <>{apiSections.map(section =>
  <article key={section.name}><h2>{section.name}</h2>
    {section.methods.map(method => <Method key={method.name} {...method} />)}
  </article>
)}</>;
```

`codeBlock()` escapes strings by default. It may also receive an explicit `HtmlFragment`, or a `highlight(source, language)` callback that returns one, allowing a server-side highlighter to compose safe token spans without accepting arbitrary HTML strings.

An `HtmlFragment` returned from `render()` is already fully composed and is never reparsed for `{{ bindings }}` or directives. This keeps code samples literal and prevents escaped documentation text from becoming executable template syntax. Return a string or use `template` when Redweb should process declarative bindings.

State observation is deliberately shallow. Assigning a new value publishes an update; mutating a nested object or array in place does not. Reassign after nested changes:

```ts
this.players = [...this.players, player];
```

## Browser actions and input

On ordinary live pages, browser-invoked methods must be decorated with `@action()`. [Socket-bound pages](SOCKET_PAGES.md) instead bind their registered typed socket handlers. For a page action:

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

`rw-click="action"` prevents default navigation and invokes an action without arguments. `rw-submit="action"` prevents submission, passes form fields as the first argument, preserves duplicate field names as arrays, and resets only an unchanged, still-connected form after the server acknowledges success. `rw-bind="property"` sends text values or checkbox state only when that property was declared with `@state({ writable: true })`.

### Browser file actions

Use `@upload()` when a page needs an original browser file rather than base64 in socket state. It is a general file-action contract: selected documents, profile images, game mods, captured media, and pasted content all arrive as the same bounded stream. `rw-upload` on a file input and `rw-paste` on any focusable element make one same-origin `POST` to the current page session; other browser file sources can use that same action protocol. A present foreign `Origin` or cross-site Fetch Metadata value is rejected, and the page identity and policy are checked again for that request. Uploads use the same pending/success/error feedback as `rw-click` and `rw-submit`; point `rw-status` at the upload method when the status should have a dedicated accessible location.

The [complete example below](#putting-uploads-providers-and-resources-together) shows the upload handler, its injected storage provider, and the pages receiving the result. There is no browser-side socket code.

`accept` is an allow-list of MIME types (including `image/*`) and `maxBytes` defaults to 10 MiB; both are enforced by Redweb on the server. The browser's `accept` attribute is only a picker hint. The handler receives `{ stream, type, name }` and must persist or process the stream before it resolves. Redweb serializes uploads with socket actions for the same page and bounds queued page work; disconnecting, session expiry, server shutdown, or an aborted HTTP request destroys the file stream. Redweb drains an otherwise unread stream so its size limit is still enforced, but it intentionally provides no file storage, public URL, durable asset reference, virus scanning, or content sniffing. Put those policies behind an injected application provider and store only its small, authorized asset reference in page state.

File actions may live on decorated class components as well as pages. Their `rw-upload`/`rw-paste` directives are scoped to the owning component automatically, exactly like regular actions.

### Server-projected resources and providers

When a shared service changes data for a known key, avoid manual socket loops. `liveResource()` routes a server publication only to active page/component instances whose `@resource()` selector currently returns that key. Changing the selector state moves the subscription; disconnecting or disposing the page removes it. A resource is in-process projection, not a database, authorization mechanism, or cross-worker event bus.

### Putting uploads, providers, and resources together

Starting from a Redweb project created with `redweb init`, replace `src/app.tsx` with this example and run `npm run dev`. Open `/notes` in two tabs and upload a small text file in either one. Both tabs display the text without a custom WebSocket handler. The example stores only one note in memory; it is deliberately not durable or suitable for private user data.

```tsx
import { action, defineApp, inject, liveResource, page, resource, upload, type UploadedFile } from 'redweb';

const noteUpdates = liveResource<string, string>();

class NoteStore {
  current = '';

  async save(file: UploadedFile) {
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    this.current = Buffer.concat(chunks).toString('utf8');
    noteUpdates.publish('shared-note', this.current);
  }

  clear() {
    this.current = '';
    noteUpdates.publish('shared-note', this.current);
  }
}

@page('/notes')
class NotesPage {
  @inject('notes') declare notes: NoteStore;
  @resource(noteUpdates, () => 'shared-note') note: string | null = null;

  @upload({ maxBytes: 64 * 1024, accept: 'text/plain' })
  async saveNote(file: UploadedFile) {
    await this.notes.save(file);
  }

  @action()
  clearNote() {
    this.notes.clear();
  }

  render() {
    return <main>
      <h1>Shared note</h1>
      <input type="file" accept="text/plain" rw-upload="saveNote" />
      <button rw-click="clearNote">Clear</button>
      <p rw-status="saveNote" role="status" aria-live="polite" />
      <pre>{this.note ?? this.notes.current}</pre>
    </main>;
  }
}

const notes = new NoteStore();
export const app = defineApp({ pages: [NotesPage], providers: { notes } });

if (require.main === module) void app.run();
```

`defineApp` owns the page instances. `providers` supplies the same `NoteStore` to each page's `@inject('notes')` field. The upload action writes through that store; `noteUpdates.publish()` then assigns the new value only to subscribed pages, causing their JSX to update. A newly opened page reads `notes.current` before its first publication. The fixed key is appropriate only because this is a public shared note; for multiple documents use a document ID as the resource key and authorize every read and write on the server. Replace the in-memory store with application-owned persistence for durable data, and apply content validation appropriate to the files you accept.

`@inject('name')` deliberately receives an explicit object from `defineApp({ providers })`; it has no container, reflection, or hidden global. Injected fields cannot have initializers and are immutable on the page instance. Keep persistence, storage URLs, scanning and authorization in these application-owned services.

When an HTML-valued component state renders new actions or bindings, Redweb automatically scopes those directives back to that component. A component can therefore replace a join form with a composer—or swap any other interactive view—without manual component IDs or browser glue.

The document emits `redweb:connection` events as transport state changes and `redweb:error` events when an interaction fails. Interactions require an open connection; they are not queued during initial connection or reconnect. Actions use request/response operations and are never automatically replayed.

Names such as `constructor`, `prototype`, and `__proto__` are rejected. Arbitrary methods and undeclared state cannot be reached through the Live HTML protocol.

## Lifecycle

Pages can implement these optional hooks:

- `loading(context)` runs before SSR and receives the portable page request, params, query, body, and shutdown `signal`.
- `connected(context)` runs after the page's authenticated socket connects and receives the socket and cancellation signal.
- `disconnected(context)` runs when that socket closes and may be asynchronous.
- `disposed()` runs once when a connection-scoped page expires or the server shuts down and may be asynchronous.

Timers and subscriptions created by a page should be owned by that page and stopped in `disconnected()` or `disposed()`. `dispose()` is idempotent.

With lower-level `start`/`LiveHtmlServer`, shutdown aborts the render signal and waits up to `shutdownTimeoutMs` (one second by default) for active `loading()` and `render()` hooks. If a hook ignores cancellation, Redweb disposes its page, force-closes the affected HTTP connection, completes the remaining cleanup phases, and then reports the timeout. `defineApp` instead coordinates cleanup within a five-second total application budget by default; see [application lifecycle](APPLICATION.md).

Lower-level Live HTML shuts down sockets, page resources, and its owned HTTP listener in successive phases. Its `shutdownTimeoutMs` bounds phases rather than imposing one total wall-clock deadline. The final HTTP phase also waits up to this duration before destroying remaining TCP peers, including incomplete HTTP requests and unfinished TLS handshakes. This applies to both static and live pages, even when native listener close has already started. Successful forced transport closure does not prove that application work completed, data was persisted, or a response reached its client. Cleanup failures remain reported after the other phases are attempted. Applications must separately close their database handles, workers, and other resources; arbitrary synchronous work cannot be preempted by a JavaScript timer.

HTTP rendering produces an unpredictable page ID. The browser presents it during a same-origin, versioned WebSocket upgrade. Pending and disconnected sessions expire, the registry is bounded by `maxSessions`, and a page ID cannot own two active sockets simultaneously.

For authenticated pages, provide `authenticate(request)`. It runs for both the HTTP render and WebSocket upgrade and must return the same stable primitive identity (commonly a user ID) for both requests. A missing, rejected, changed, or object identity is denied, preventing a copied page token from crossing authentication boundaries. The identity is available as `context.principal` in page hooks and actions.

## Validated action inputs

Use the same Standard Schema v1 validators supported by socket contracts to validate a form once, at the server boundary. Redweb adds no runtime schema-library dependency; install your chosen validator in the application (`npm install zod` for this example).

```tsx
import { action, defineApp, page, state, type ActionInput } from 'redweb';
import { z } from 'zod';

const input = z.object({
  amount: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(1000)),
}).strict();

@page('/')
class AmountPage {
  @state() total = 0;

  @action({ input })
  save(value: ActionInput<typeof input>) {
    this.total += value.amount;
  }

  render() {
    return <form rw-submit="save">
      <label>Amount <input name="amount" /></label>
      <button type="submit">Add</button>
      Total {this.total}
    </form>;
  }
}

const app = defineApp({ pages: [AmountPage] });
app.run();
```

The browser sends form values as one object (repeated names become arrays). The schema converts `amount` from its submitted string to an integer between 1 and 1,000, rejecting overflow and out-of-range values after conversion. `ActionInput<typeof input>` describes that transformed result; TypeScript cannot infer a method parameter annotation from its decorator. An optional second `LivePageConnectionContext` parameter receives trusted server context, never a caller-supplied replacement. Both standard and legacy TypeScript decorators are supported, including scoped component actions. A validated action accepts exactly one submitted argument; ordinary `@action()` retains its existing argument behavior.

Invalid input produces `ACTION_INVALID_INPUT`, does not invoke the method, and leaves the socket open for correction. The browser reports it through `redweb:error` and does not reset the failed form. Validator exception details, submitted values, and raw schema issues are not returned to the browser. A throwing validator or malformed validator result remains a sanitized `HANDLER_FAILED` server error, not a recoverable user mistake.

Validation has a five-second default deadline; override it with `@action({ input, validationTimeoutMs: 500 })`. A validation deadline produces `ACTION_VALIDATION_TIMEOUT`; an interrupted validation produces `ACTION_CANCELLED` if the connection can still receive a response. Neither invokes the action. Disconnects and disposal prevent an outstanding validation result from starting application code later. These limits apply to validation, not to an action that has already started: Redweb cannot undo its side effects, preempt synchronous JavaScript, or stop external work inside a validator. It does not automatically retry actions. Prefer pure validators, and implement application-specific cancellation/idempotency where needed.

The same bounded validation implementation is shared with socket contracts. Their existing `INVALID_PAYLOAD` contract error behavior is unchanged. Automatic action feedback reports safe form-level messages, not raw validator issues or field-level messages.

## Action authorization

Identity and permission are separate: the server's existing `authenticate(request)` hook establishes `context.principal`; an action policy decides whether that identity may perform this operation. In Redweb 0.15.0, add `authorize` to the action decorator instead of repeating permission checks inside each method:

```tsx
// Inside a page/component; `input` is the amount schema from the example above.
@action({
  input,
  authorize: (context, value) => context.principal === 'owner' && value.amount <= 10,
})
save(value: ActionInput<typeof input>) {
  this.total += value.amount;
}
```

The policy receives **trusted context first, transformed input second**. Only `true` permits invocation. The check runs after validation on every invocation, so a permission change during asynchronous validation is visible to the policy. Both standard and legacy decorators and component-scoped actions follow the same path. The literal owner check above illustrates the API, not an authentication system: applications must verify real credentials in `authenticate`, query their own current permissions, and enforce database ownership/transaction rules.

For a button without a schema, use `@action({ authorize: context => context.principal === 'owner' })`. Such methods use the fixed signature `run(input: unknown, context: LivePageConnectionContext)`; with no submitted payload, `input` is `undefined`. A caller can supply at most one untrusted input, never replace the second context argument. Use a schema whenever you inspect submitted values. Ordinary `@action()` keeps its existing variadic behavior.

Policies may be asynchronous. `authorizationTimeoutMs` defaults to 5,000 ms and requires an `authorize` callback. This deadline is separate from `validationTimeoutMs`; neither bounds a method that has started. The policy's `context.signal` aborts when the connection closes or the permission deadline expires. Pass it to cancellable application operations. Redweb cannot preempt synchronous code, cancel work that ignores the signal, undo policy side effects, or make a policy check and later database write atomic; keep policies read-only and enforce transactional authorization in storage where required. An overdue or cancelled result cannot invoke the action later. Page disposal also prevents invocation, but does not itself stop ongoing external policy work.

Denial returns recoverable `ACCESS_DENIED`; timeout returns `ACCESS_TIMEOUT`; connection cancellation returns `ACCESS_CANCELLED` when a response can still be delivered. None invokes the action. Built-in feedback shows safe text and retains the draft. A thrown/rejected policy is a sanitized `HANDLER_FAILED` application failure, not a permission denial, and must be investigated rather than blindly retried. Authentication/permission secrets and submitted values are never included in these protocol errors.

**An action policy protects action invocation only.** It does not protect HTTP rendering, loading hooks, writable state, room publication, or passive subscriptions. Use the page policy and explicit session revocation below for page access. Shared page state is shared across identities, not private per user. Durable dashboard and room-policy recipes remain separate acceptance items.

## Protected pages and shared request identity

In Redweb 0.15.0, a page can declare `authorize(context)` alongside its route. This is an API pattern for an application that already supplies the server's `authenticate(request)` hook, not a standalone login system:

```tsx
@page('/account/:id', {
  authorize: ({ principal, params }) => principal === params.id,
  authorizationTimeoutMs: 500,
})
class AccountPage {
  render(context: LivePageRequestContext) {
    return <h1>Account {context.params.id}</h1>;
  }
}
```

Redweb reserves render capacity, captures the request, resolves identity, and checks permission **before constructing this page or running its loading hooks**. Only `true` allows access. Protected pages require connection scope; `shared: true`/`scope: 'shared'` are rejected because a shared mutable instance is not private per identity. Keep public shared counters/chat state separate from private account state. Page policies are checked again on socket admission/reconnect, immediately before actions (after input validation and action authorization), and before browser-writable state changes. Returning false denies that operation; it does not automatically disconnect idle viewers.

`authenticate(request)` still receives the real HTTP/upgrade request, so it can use the application's existing cookie/session/token implementation. It must verify credentials and return a primitive identity: string, finite number, bigint, or `true`. False/null/undefined and objects/functions/symbols/non-finite numbers are rejected. An upgrade must authenticate as the same identity that rendered its page token. `authenticationTimeoutMs` defaults to 5,000 ms and requires an authentication hook. A timeout prevents later admission, but cannot stop external work inside that hook. Redweb does not provide credential storage, login endpoints, or distributed session invalidation.

Loading/rendering, connected/disconnected hooks, and actions share the original HTTP page's `request`, `params`, `query`, `body`, and `principal`. `LivePageConnectionContext` extends `LivePageRequestContext` and adds `socket`; its signal belongs to the current connection. The request does not become the upgrade URL when reconnecting. It is a deep-frozen copy of supported fields, not an Express request: path, URL, method, headers, params, query, JSON-compatible body, and a case-insensitive header `get()`. It never retains an Express response/socket graph or freezes application-owned objects. Nested data has a depth limit of 16 and a conservative 64 KiB aggregate budget, including per-value overhead; arrays are additionally limited to 8,192 entries. Dates, functions, and other unsupported body values must be normalized by application middleware. Header values, including credentials, remain private server-side data; do not render or log them unnecessarily.

Denied HTTP authentication returns `AUTHENTICATION_REQUIRED` (401); authentication timeout/cancellation return `AUTHENTICATION_TIMEOUT`/`AUTHENTICATION_CANCELLED` (503); authentication hook failures return sanitized `AUTHENTICATION_FAILED` (500). Page permission denial is `ACCESS_DENIED` (403), with bounded policy timeout/cancellation at 503. Broken policies or protected-page application errors return sanitized `PAGE_FAILED` (500). Protected responses, including errors and non-live pages, are `private, no-store` and never use conditional 304 responses. `exportStatic()` and `defineSite().export()` reject authorized pages before construction or final output writes.

## Explicit session revocation

After invalidating a credential or changing permissions in your own authority, call `await server.revoke(principal)` before publishing further private updates. `server` can be your Application from `defineApp` or the lower-level object returned by `start()`. This revokes matching rendered page tokens, live connections, and unfinished renders in this process. It is not a permanent identity denylist: a later HTTP request may establish a new session only if your authentication and page policy still allow it. Coordinate revocation across every application instance yourself.

All affected lifetimes are marked unavailable and their transports stopped synchronously, before application-visible abort listeners or cleanup hooks run. Therefore an abort listener cannot publish a final framework state update to another affected connection. Old page tokens cannot reconnect, and late authentication, policy, loading, connection-hook, validation, or render completions cannot restore them. In-flight identity lookups whose principal is not yet known are conservatively cancelled too; an unrelated in-progress login may need retrying. The returned number counts affected page sessions/render operations, including those unresolved lookups, not unique people or sockets.

Application disconnect/disposal cleanup is awaited up to `shutdownTimeoutMs`. `REVOCATION_CLEANUP_FAILED` means access has already been revoked but cleanup rejected or exceeded the deadline; it never restores access. Revocation cannot retract data already sent/buffered, roll back application side effects that already started, or cancel external work that ignores its signal. Ordinary network disconnect cancels connection work but preserves eligible session state for reconnect; explicit revocation permanently invalidates that page token. Abandoned HTTP requests cancel their render lifetime and release framework capacity even if a loading hook ignores cancellation.

Use `LiveHtmlStartOptions` for wrappers around `start()`; it preserves the authentication/timeout constraints without writing `Omit<LiveHtmlServerOptions, 'pages'>`. The starter recipes use this shorter public type.

## Automatic action feedback

Existing `rw-click` buttons and `rw-submit` forms show **Working…**, **Done.**, or a safe error message without custom browser JavaScript. Redweb inserts a plain-text status span at the end of a form or immediately after a click control, with `role="status"` and `aria-live="polite"`. The control and its status have `data-rw-status="pending"`, `"success"`, or `"error"` for application CSS. Native form constraints still run before submission.

For deliberate placement, supply a slot in the same component (or page scope):

```tsx
<form rw-submit="save">
  <label>Amount <input name="amount" /></label>
  <button type="submit">Save</button>
  <output rw-status="save" />
</form>
```

This replaces the automatic span for that action. Slots receive text, never HTML. Redweb preserves authored accessibility attributes; use an `output`, or add an appropriate live-region role to another element. Slots are component-scoped, including wrapper-free/nested components. If several controls in one scope share a slot, the most recently started invocation owns that slot; an older completion cannot overwrite it. Do not combine `rw-status` with a server-rendered state binding on the same node.

Each control allows one pending invocation; repeated clicks/submits from that same DOM node are ignored until it settles. Other controls remain independent, with a fixed page-wide maximum of 32 outstanding actions. This is UI duplicate suppression, not authorization, server rate limiting, or an exactly-once guarantee. Inputs stay editable and controls keep their authored accessibility/disabled attributes. A successful form resets only if its node, action binding, submitted values, and input/change revision are unchanged. New drafts, failed forms, and replacement forms are never cleared by an old response. Use stable JSX keys to preserve the intended node identity during reordering.

Feedback follows surviving nodes through server patches, including replacement status slots; removed controls release their generated status nodes and clear slots they still own. A replacement control does not inherit an old invocation's outcome. The most recently started invocation keeps ownership when controls share a slot, so late results cannot overwrite its feedback.

Disconnected actions are not queued, and actions are never automatically retried. The browser reports a known-unsent action separately from an unconfirmed result. A lost connection, response timeout, or application failure can occur after side effects; the message asks the user to check before trying again. Successful completion confirms the response, not durable persistence. Applications remain responsible for transactions, idempotency, and durable storage. Browser state writes are also not queued while disconnected. `redweb:error` remains available for application-level reporting, and `data-rw-connection` on the document element reflects the current client connection state.

## Browser transport

The injected module uses the published `redweb-client` package served by the same Redweb listener. It derives `ws:` or `wss:` from the current page, negotiates protocol version `1`, uses one socket per page, delegates DOM events at the document level, and opts into bounded reconnection attempts. Every initial connection and reconnect receives an authoritative state snapshot. Supplying the normal `ssl` option runs both the page and socket over HTTPS/WSS.

## Options

`defineApp({ pages, ...options })` accepts these Live HTML controls. `start(PageClass, options)` and `new LiveHtmlServer({ pages, ...options })` remain lower-level alternatives:

- `pages`: non-empty array of decorated class constructors when using `LiveHtmlServer` directly.
- `templateRoot`: optional root for all `.html` templates and CSS files; when omitted, each page uses the source directory captured by its `@page()` decorator.
- `livePaths.css`: optional internal URL prefix for generated stylesheet routes; defaults to `/__redweb/css`.
- `sessionTtlMs`: pending/reconnect session lifetime; defaults to 30 seconds.
- `maxSessions`: maximum pending plus active page sessions; defaults to 1,000.
- `maxConcurrentRenders`: maximum simultaneous HTTP page renders, independent of live session occupancy; defaults to `maxSessions`.
- `shutdownTimeoutMs`: `defineApp` uses a five-second total application shutdown budget by default. The lower-level `start`/`LiveHtmlServer` option instead defaults to one second per render/route drain and final owned-HTTP cleanup phase; it is not a total application deadline.
- `heartbeat`: optional `{ intervalMs, timeoutMs }` WebSocket liveness policy. Live HTML defaults to a 15-second ping interval and 10-second pong timeout so half-open browsers are disconnected and component `disconnected()` hooks update presence promptly. When a pong first expires, one unreferenced timer gives it an additional `timeoutMs` grace window to reach JavaScript. Pong handling, detach/reattach, and shutdown cancel that owned timer; a peer that remains silent is terminated when it fires. Scheduler latency means `timeoutMs` is a liveness threshold, not a hard wall-clock deadline; use connection and queue limits as the resource bounds.
- `authenticate`: optional HTTP/WebSocket identity function for binding page sessions to an authenticated principal.
- `origins`: optional exact origin list or predicate for deployments behind a trusted proxy. Without it, Redweb requires a scheme-and-host match (`http`/WS or `https`/WSS).
- `livePaths`: optional `{ socket, client, runtime }` internal path overrides.

The internal paths and application page paths must be unique.

## Verification examples

- `examples/live-html/counter.ts` uses `@page()`, colocated CSS, and `@state()` to prove a connection-owned server timer can update browser state and is stopped on disconnect.
- `examples/live-html/chatroom.tsx` uses a connection-scoped `@component()` backed by a room service created by `createChatroomPage()`, so separate server instances cannot leak history or names. Visitors join once, receive a stable dedicated composer, see a capped presence list with the total online count, share bounded history, and recover their identity and missed messages after reconnect. Join/send use `@action({ input })` with shared Zod text schemas for normalization, bounds and inferred `ActionInput` types; invalid input gets automatic form feedback before the method runs. The chat starter includes Zod as an application dependency, not a new Redweb runtime dependency.
- `examples/live-html/cards.ts` uses a shared decorated page, `@view()`, and `rw-each` to prove server-rendered collection SSR, realtime replacement, and persistence across reloads and reconnects while the server is running.
- `examples/live-html/components.ts` uses two instances of one `@component()` class to prove reusable markup, isolated server state, scoped actions, and component CSS composition.
- `examples/live-html/jsx-page.tsx` uses Redweb's automatic JSX runtime, a function component, decorated state, and a server action without HTML template strings.

Run the examples immediately with `npm run example:counter`, `npm run example:chatroom`, `npm run example:cards`, `npm run example:components`, and `npm run example:jsx`. Their checked-in JavaScript artifacts are generated from the decorated TypeScript or TSX sources, and every test and package build rejects stale output. The artifacts are launched unchanged by `tests/integration/live-html.integration.test.js` over real loopback HTTP and WebSocket connections. Run the focused gate with `npm run verify:live-html`, or the complete 100% coverage suite with `npm test`.

These commands assume the cloned repository's development dependencies are installed. For the packed chat example used directly in another application, install `zod` there first; the generated chat starter already declares it. Core Redweb and the counter example remain usable without a validator library.

## Static pages and documentation export

Set `live: false` when a page needs server rendering but no realtime session:

```tsx
import { exportStatic, page } from 'redweb';

@page('/docs', {
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
class DocsPage {
  render() { return <h1>Redweb API reference</h1>; }
}

await exportStatic(DocsPage, { outDir: 'dist' });
```

Non-live pages contain no page token or browser runtime. When served through `defineApp`, Redweb skips their live-page WebSocket route, emits an ETag, honors `If-None-Match`, and applies the declared public cache policy. Other explicitly registered socket routes remain available. Interactive pages are always sent with `private, no-store`.

`exportStatic()` accepts one decorated class or an array. It requires `live: false`, maps `/` to `index.html` and `/docs` to `docs/index.html`, emits content-addressed CSS beside the pages, and returns frozen lists of written files. It never deletes or cleans the output directory.

For several pages, define shared defaults once:

```tsx
import { defineSite } from 'redweb';

const docs = defineSite({
  origin: 'https://example.com',
  css: 'site.css',
  head: { description: 'Redweb documentation' },
  cache: { maxAge: 300 },
  layout: (content, context) => (
    <body data-path={context.request.path}>
      <nav>Redweb</nav>
      <main>{content}</main>
    </body>
  ),
});

@docs.page('/docs', { head: { title: 'Documentation' } })
class DocsPage {
  render() { return <h1>Documentation</h1>; }
}

await docs.export(DocsPage, { outDir: 'dist', publicDir: 'public' });
```

`defineSite()` creates runtime-free page decorators, merges and deduplicates shared CSS, inherits head/cache/layout defaults, and derives canonical URLs from `origin`. Shared and page-local styles resolve from the modules that declare them. Layouts receive a trusted page fragment plus the normal render context, run synchronously, and must return `html`. `site.export()` stages a validated, link-free `publicDir` with the rendered pages before touching the destination, rejects case-insensitive public/generated path collisions, never cleans existing output, and includes copied files in its returned `assets` list.

The request exposed to `loading()` and `render()` is deliberately the portable `LivePageRequest` surface: `path`, `url`, `method`, `headers`, `params`, `query`, `body`, and `get(name)`. HTTP rendering supplies these from Express; static export supplies deterministic empty headers, parameters, query, and body values. Framework-specific Express request methods are not part of the page contract.
