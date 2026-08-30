# Your Redweb application

Requirements: Node.js 18 or newer and npm for the realtime, chat, site and socket templates; the dashboard template requires Node.js 22.13+ for native SQLite. Use a currently supported Node.js release in production.

```sh
npm install
npm test
npm run dev
```

HTTP starters open at http://localhost:8181; the authenticated dashboard uses http://127.0.0.1:8181/login and requires account provisioning described below. Set the `PORT` environment variable to change the listener.
`npm test` builds and runs real HTTP/WebSocket integration tests on an ephemeral loopback port. No mocks or external service are needed.

## Development and production

Edit `src/app.tsx`. `npm run dev` watches TypeScript, TSX, CSS, HTML, and the root TypeScript configuration,
then rebuilds and restarts the server. A type error stops startup until you fix it. On direct localhost access,
HTML pages refresh automatically when a new server revision is ready. If edits were detected, a keyboard-accessible
notice keeps the old document until you choose **Reload and discard drafts**. This is a conservative edit guard,
not autosave or browser hot-module replacement: restarts reset in-memory state and old socket sessions.
The generated development command sets `REDWEB_DEV_REFRESH=1`; `development: { refresh: false }` overrides it.
The refresh feature is refused under `NODE_ENV=production`, applies only to served HTML (not raw sockets or static exports),
and creates no local/session-storage copy of form contents. Use direct `localhost`, `127.x.x.x`, or `[::1]` access;
custom hostnames, tunnels and proxy-forwarded origins are not supported by this development helper.
`npm run build` checks types and copies CSS/HTML beside the compiled classes in `dist/`.
Run `npm start` to serve the compiled app. For deployment, build first, ship `dist/`, `package.json`, and the lockfile,
then install runtime dependencies with `npm ci --omit=dev`. The application does not require TypeScript or `src/` at runtime.

For public deployment, configure HTTPS/WSS at your Node server or reverse proxy, authentication, trusted origins,
and application-specific rate limits. These starters are demonstrations, not a hosted identity or database service.
Never commit secrets; `.env` is ignored but is not loaded automatically.

`npx redweb doctor --json` reports configuration problems without changing your files.
