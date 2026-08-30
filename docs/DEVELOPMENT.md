# Development inspection

This API is **unreleased**. Use the matching packed candidate rather than assuming it exists in the published package.

Enable inspection explicitly when starting a development application:

```ts
const app = start(CounterPage, {
    port: 8181,
    development: { inspect: true },
});

// Read this in your development code, debugger, or integration test.
console.dir(app.inspect(), { depth: null });
```

`SocketServer` and `SecureSocketServer` accept the same option and expose the same `inspect()` method. Without the option, `inspect()` returns `null`. Merely setting `NODE_ENV=development` does not enable inspection. Explicitly enabling it while `NODE_ENV=production` throws before routes or listeners are attached. The environment check occurs at construction; changing environment variables afterward is not a runtime mode switch.

This is an in-process, read-only API. It does not create an HTTP/debugging route, listener, browser script, background timer, or automatic logger. Do not expose its return value through an application endpoint in production. Your existing `redweb doctor --json` command remains the source/configuration checker; it does not inspect a running process.

## What the snapshot means

`inspect()` returns immutable, versioned JSON-compatible data:

- `pages.registrations`: configured route paths, live/shared flags, class names, decorated action/state names, and descriptions of currently available owned components. It never constructs a page to discover its members. Standard decorator metadata and component fields may not exist before first construction, so `instanceMetadata: "unobserved"` means an incomplete inventory, not “this page has no actions.” Static or expired pages can have no current instance even when class metadata was observed previously.
- `pages.connections`: separate counts for pending HTTP-created sessions, connected sockets, disconnect hooks in progress (`detaching`), and disconnected sessions retained for reconnect. Shared pages appear once in each registration's instance list even when several visitors use them.
- `pages.sessions`: bounded per-render descriptions using inspector-local numeric IDs. These are not page tokens, credentials, principal IDs or socket IDs. A reconnect to the same retained page session keeps its renderer ID.
- `sockets.routes`: registered socket paths and handler names, registered connection counts, draining status, and room/session counts. Runtime-added routes and handlers appear on the next read. `pendingUpgrades` counts currently tracked handshakes. Room names, session identifiers and stored data are omitted. A registered raw connection is not a promise that every transport is currently open; lifecycle cleanup may be in progress.
- `history`: the latest reactive state invalidations and flush attempts. A state invalidation lists the member/component name and affected render-owner IDs. An empty affected-owner list means no current reactive owner read that member. Several invalidations can be batched into one flush.

Page-session and underlying socket counts describe overlapping resources—do not add them together as independent visitors. Counts remain available independently of truncated detail lists. A description failure yields `available: false` for its section without reflecting exception text.

## Render history is not delivery tracing

`flush-started` reports whether the attempt is a reconnect/attach snapshot and which owners were dirty. `flush-completed`, `flush-superseded`, and `flush-failed` describe that attempt, with elapsed milliseconds. Completion can mean unchanged HTML, no transport write, or a transport write that the peer did not receive. It is **not** a delivery acknowledgement. Supersession means a disconnect, disposal or generation change made the attempt obsolete.

History does not attribute an invalidation to a particular action: timers, services and application code can also assign state. It does not retain action arguments, state values, HTML, request headers, cookies, query parameters, identities, socket contexts, or exception messages. It does not serialize getters or call action/render/lifecycle callbacks to produce a snapshot. Application accessors replacing declaration fields are skipped; standard action metadata excludes replaced accessor methods. This is not a security sandbox against hostile JavaScript Proxies or global monkey-patching.

The history observes the reactive TSX renderer's connected update path, starting with socket attachment. Initial HTTP rendering, static output, changes with no connected reactive renderer, and nonreactive template `redweb:state` transport messages are not traced. `pages.sessions[].reactive` distinguishes those sessions. Existing runtime failure diagnostics and application tests remain necessary.

## Bounds and overhead

History retains at most 256 entries per inspected server and only primitive metadata; each event's owner list retains at most 100 names. Current page/socket description lists retain at most 100 items each and share a separate 1,000-item budget per snapshot. Lists include `total` and `truncated`. Labels are limited to 128 UTF-16 code units. Names and route paths are application-defined declarations: do not put secrets in them. The local history's `total` is its sequence counter, including any contained recording failure; retained entries may therefore have gaps.

Inspection selects a specialized renderer once for the enabled server. Ordinary reactive invalidation, flush, and socket-message paths have no inspector callbacks or added inspection branches. Disabled servers retain the original renderer class. The only ordinary rendering seam is renderer-class selection when a page session is constructed. Enabled inspection deliberately does extra metadata work and allocations; its timings are diagnostic observations, not production benchmarks.

Shutdown removes page sessions and connections through the existing lifecycle. The bounded primitive history remains readable while you retain the server object; it does not keep disposed page instances alive. The inspector's local ID table uses weak keys.
