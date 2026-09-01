# Persistent private dashboard

This recipe combines decorator-first pages, reusable live cards, validated actions, and real SQLite persistence. It is an application example, not an authentication framework or managed database.

## Run it

Requires **Node 22.13 or newer** (native `node:sqlite`, experimental in Node 22) and npm. Other Redweb starters retain their own Node requirements. Use a supported Node release in production.

After installing dependencies, create your account:

```sh
npm run add-user -- alice
npm test
npm run dev
```

The provisioning command displays a randomly generated password once. Save it securely; there are no default accounts or passwords. Open **http://127.0.0.1:8181/login**, sign in, and add a card. A second signed-in tab updates immediately. Restart the app: your cards and unexpired credentials remain valid. Sign out all sessions to close every connected tab for that account and invalidate all its cookies.

`npm test` provisions temporary test accounts and a real temporary database, then exercises HTTP, WebSockets, isolation, restart, and session expiry. It never modifies your application database. Integration tests use no mocks. A separately labelled unit test injects a cleanup error after closing a real SQLite database to verify rejection handling; it does not simulate a real operating-system failure.

`npm run test:coverage` measures the TypeScript application through source maps, separately from Redweb's own instrumented-library coverage. It also waits through the actual one-minute login admission window without mocking the clock. The report includes TypeScript-generated decorator accessor functions; inspect that distinction rather than assuming a library coverage figure applies to this recipe. The generated npm configuration enforces this recipe's Node engine requirement before installation.

## Where the behavior lives

- `app.tsx`: composition, login page, protected dashboard, listener and shutdown.
- `cards.tsx`: reusable `Cards` component and account-scoped live subscriptions. Normal TSX expressions update automatically. Forms call typed actions; feedback requires no browser glue.
- `store.ts`: prepared SQL, bounded cards/sessions, owner-filtered operations and synchronous transactions.
- `auth.ts`: asynchronous scrypt, bounded login attempts, hashed session tokens, cookies and sign-out.
- `admin.ts`: explicit local account provisioning.

## Production boundaries

Set `DASHBOARD_DATABASE` to a writable persistent file path (default `data/dashboard.sqlite`). Protect the directory with OS permissions: the database contains password hashes, private card text, and session metadata. It, its WAL/SHM files, and backups must never be served as public assets or committed. Stop the process cleanly before copying the database for a backup, or use a proper SQLite online backup facility; copying only the main file during live WAL writes is not a backup plan.

Set `NODE_ENV=production` and `DASHBOARD_ORIGIN=https://your-domain.example` behind an HTTPS reverse proxy. The origin must have no path or trailing slash. This enables Secure cookies; all session cookies are HttpOnly and SameSite=Strict. Both login/logout forms and socket upgrades require the exact trusted origin. The application does not trust Host or forwarded headers to establish origin or identity. The HTTP listener must not be publicly reachable around your TLS proxy.

Provision accounts on the same persistent volume before serving requests. Passwords use salted scrypt; only hashes of random session tokens are stored. Default sessions last one hour. Up to 32 unexpired sessions and 100 cards per account are supported. Login work is limited to four simultaneous checks and ten attempts per minute per direct peer IP, with at most 1,024 tracked IPs; clients behind one proxy share its bucket. Add appropriate proxy-level abuse controls for an Internet deployment. There is no registration, password reset, MFA, or account recovery; integrate a dedicated identity provider if your product needs those features.

SQL checks the current session and card owner inside each write transaction. Private subscriptions recheck session validity before publishing and close at expiry. Sign-out invalidates credentials before revoking Redweb sessions. An expired or disconnected page may need a reload/sign-in; the recipe does not silently retry actions with uncertain outcomes.

This is a **single-process live-update model**. SQLite transactions are synchronous and kept small; this is not a claim of unlimited concurrency. Do not put multiple app workers behind a load balancer and expect cross-worker notifications or revocation. Add a deliberate shared notification/session-revocation design before scaling horizontally. Static export cannot include protected dashboards.

Build and deploy using the shared instructions above, including the persistent data volume and the environment settings here. Neither `npm run dev` nor a process restart should erase durable cards. Redweb itself does not depend on SQLite.
