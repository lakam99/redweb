# One application, one listener

`defineApp()` describes the application. `await app.run()` initializes it and opens one port for HTTP pages and WebSocket routes. You do not create an HTTP server and then pass it to a second socket server.

This API is currently unreleased. Use the matching checkout or development tarball, not the published 0.13.5 package.

## The entry point

In a Redweb TypeScript project, the application can be as small as:

```tsx
import { defineApp, page, action, state } from 'redweb';

@page('/', { shared: true })
class HomePage {
    @state() count = 0;
    @action() increment() { this.count += 1; }
    render() {
        return <main><h1>Hello</h1><button rw-click="increment">Count {this.count}</button></main>;
    }
}

@page('/about', { live: false })
class AboutPage {
    render() { return <main><h1>About this app</h1></main>; }
}

const app = defineApp({ pages: [HomePage, AboutPage], port: 8181 });

async function main() {
    await app.run();
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
```

The final error handler is for this CommonJS TypeScript entry point; an ESM project that permits top-level await can simply use `await app.run()`. A module that is also imported by tests should export its application definition and guard its entry-point invocation with `require.main === module`. Importing a definition never opens a port or installs signal handlers.

## Add socket routes and services

The same definition accepts all three registration arrays:

```ts
const app = defineApp({
    pages: [HomePage, AboutPage],
    sockets: [MatchRoute, ChatRoute],
    services: [GameSimulation],
    port: 8181,
});

await app.run();
```

These names refer to your application's classes. A page's decorator chooses its HTTP path. A `SocketRoute` chooses its WebSocket path, such as `/match`; its handlers dispatch `join`, `move`, and `resume` by message `type`. Live-page connections and custom socket routes share one upgrade listener. Do not register a custom socket route at the live-page socket path.

In five-year-old terms: the app has one front door. Pages are ordinary visits, sockets are ongoing conversations, and services are the staff who prepare the building before the door opens and clean up after it closes.

`services` are application-wide lifecycle classes, not HTTP endpoint descriptors or route-specific `SocketService` classes:

```ts
import type { ApplicationContext, ApplicationService } from 'redweb';

class GameSimulation implements ApplicationService {
    private timer?: ReturnType<typeof setInterval>;
    private ticks = 0;

    onInit(app: ApplicationContext, signal: AbortSignal) {
        signal.throwIfAborted();
        app.app.get('/health', (_request, response) => response.json({ ticks: this.ticks }));
        this.timer = setInterval(() => { this.ticks++; }, 1000);
    }

    onShutdown() { clearInterval(this.timer); }
}
```

Keep constructors inert. Acquire resources in `onInit(app, signal)` and release them in `onShutdown()`. Initializers run in registration order before the port opens; cleanup runs in reverse order, including the service whose initialization failed. Asynchronous methods are supported. Pass the abort signal to cancelable work and make cleanup safe after partial initialization. A deadline cannot stop arbitrary code that ignores cancellation or blocks the event loop.

Use `httpServices` for the existing HTTP endpoint descriptor array. Keep route-specific `SocketService` registrations on their `SocketRoute`. For an existing Express application, pass it as `server`; Redweb still creates and owns the underlying Node listener. The low-level server classes remain available for applications that explicitly manage their own listener ownership.

## Lifecycle contract

- Definitions are deferred. `app.server`, `app.app`, `app.http`, and `app.sockets` are initially `null`. Await `run()` before accessing their runtime values; its returned value has non-null HTTP members in TypeScript.
- `pages`, `sockets`, and `services` are optional. HTTP-only, socket-only, and non-live-page applications use the same entry point. Non-live pages need no WebSocket server unless custom socket routes were supplied.
- Repeated `run()` calls share the pending or successful startup promise while the application is running. `shutdown()` is idempotent. A stopped application cannot restart; define a new application instead.
- Startup failure rolls back resources before rejection, subject to the shutdown deadline. Cleanup failures are retained alongside the original startup error, not reported as success.
- `startupTimeoutMs` and `shutdownTimeoutMs` default to 5000. Each is one total application budget, not a fresh full timeout for every service. Shutdown cancels pending startup, closes admission, attempts page/socket cleanup, closes owned connections, and releases services.
- `signals: true` is the default. Signal handlers are installed when `run()` begins, so SIGINT/SIGTERM also cancel pending initialization. Unexpected listener closure and listener errors trigger owned shutdown. Repeated signals do not bypass active cleanup. Failed process-owned cleanup sets a failure exit status and retains a deadline for leaked handles. Explicit `shutdown()` rejects on cleanup failure but never forcibly exits its caller.
- Tests and embedded applications should set `signals: false` and call `shutdown()` in their own cleanup. Use `port: 0` for an OS-assigned test port. TLS uses the existing `ssl` key/certificate options and shares one HTTPS/WSS listener.

## Boundaries

This is application composition, not dependency injection, a distributed worker manager, or durable storage. It does not automatically inject services into page constructors. `shared: true` shares in-process state across visitors, not across server processes or restarts. Static file export remains the separate `exportStatic()` API; a non-live page served over HTTP is not a static export.

`app.revoke(principal)` revokes matching live-page sessions and returns their count; it returns zero when no live-page server has been created. `app.inspect()` exposes opt-in development metadata and otherwise returns `null`. These preserve the same live-page policies as `start()`.

`app.options` is the copied definition. An independent test instance can use `defineApp({ ...app.options, port: 0, signals: false })`, followed by `await run()` and owned cleanup. This creates new page/service instances, but does not clone an Express application or objects deliberately captured by class closures. The chat module exports a default `ChatroomPage`; its optional `createChatroomPage()` factory creates isolated rooms for separate apps or tests.

For rendering and CSS see [Live HTML](LIVE_HTML.md). For message validation and handler classes see [socket contracts](SOCKET_CONTRACTS.md). For deployment and persistence boundaries see [operations](MULTIPLAYER_OPERATIONS.md).
