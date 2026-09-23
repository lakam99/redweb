# Build a private realtime dashboard

Build a page where signed-in users create cards, see their other tabs update, and find the same cards after a server restart. Use the dashboard starter on **Node 22.13 or newer**; this application uses native SQLite. It is a complete application recipe, not a new database or authentication framework inside Redweb.

## Explain it like I'm five

Think of SQLite as a locked notebook and each browser tab as a window onto it. The server checks whose notebook you may open before reading or changing a card. After a successful change, it tells that account's other open windows to read their latest cards. The windows are not the notebook: closing them does not erase saved data.

## Follow the design

1. The setup command below provisions `alice` after installing dependencies. It prints a generated password once; save it privately. There is no default password. Open `http://127.0.0.1:8181/login` after development starts.
2. `app.tsx` composes the store, session checks, protected page and shutdown. The `Cards` component below owns presentation and actions, not the database connection.
3. `loading()` reads the current account's cards. `connected()` subscribes that browser connection to private updates; disconnect and disposal release the subscription.
4. The add/remove actions validate form input before calling the store. The store rechecks the session and owner within each write transaction; a hidden input is not permission to delete someone else's card.
5. `PrivateCards.publish()` refreshes only valid subscribers for that account. Assigning the new array to decorated state updates keyed TSX without a manual browser message handler.

See the complete [composition](../../recipes/dashboard/app.tsx), [store](../../recipes/dashboard/store.ts), [authentication](../../recipes/dashboard/auth.ts), and [acceptance tests](../../recipes/dashboard/app.test.cjs). The generated recipe supplies all of them together.

## Check that it works

Sign in from two tabs, add a card in one, and confirm both show it. A different account must not see it. Restart the process with the same database path and confirm the card remains. Sign out all sessions and verify both tabs lose access. `npm test` exercises real HTTP, WebSockets, temporary SQLite data, account isolation, restart and expiry; it does not modify your application database. Run your own browser checks for the browsers you support.

## Before deployment

Keep `DASHBOARD_DATABASE` on a writable persistent volume and out of public assets, source control and logs. Follow the [recipe's origin, cookie, account-provisioning and backup instructions](../../recipes/dashboard/README.md). Browser refresh is not persistence; successful storage and a retained database are what preserve cards.

On a compiled-only deployment, provision accounts with `node dist/admin.js alice` using the same database environment and volume, before starting the service. The development `npm run add-user` script rebuilds first and therefore needs development tooling; the compiled administrator command does not. Never copy a generated password into logs or deployment manifests.

This recipe uses **single-process** notifications and revocation. Multiple workers do not automatically exchange updates or logout events. It has no password reset, MFA or account recovery; use a dedicated identity integration when those are requirements. Do not replace server-side permission checks with a `shared: true` page containing private state. See [request and room authorization](../ROOM_AUTHORIZATION.md) and [production boundaries](../PRODUCTION_READINESS.md).
