# Team room trial

Uses the nominated local Redweb candidate archive, not published Redweb.

```powershell
npm install
npm run build
$env:PORT='0'; node dist/app.js
```

The process binds only `127.0.0.1` and prints a JSON object containing its actual URL. Open that URL in two tabs, choose names and join. The counter and last 100 messages are held in server memory. Unsent drafts remain local to each tab.

## Actual-network browser test

```powershell
$env:NODE_OPTIONS='--use-system-ca'
$env:PLAYWRIGHT_BROWSERS_PATH="$PWD\.browsers"
npx playwright install chromium
npm test
```

The test starts the compiled app on an ephemeral loopback port, uses real HTTP and Chromium WebSocket traffic, checks two-way chat/counter updates, literal markup, drafts, fresh-page history and disconnect presence, and closes its browser/server processes. Chromium is already installed locally in this submitted trial directory.

No authentication, restart durability or multi-process synchronization is provided. Duplicate display names are allowed. See `TRIAL_LOG.md` for self-reported trial telemetry.
