# Neutral application foundation

The default initializer creates a working TypeScript/TSX application without choosing a product domain. Replace `HomePage` with your pages, then add socket routes and application services as needed.

Use `--with auth,multiplayer` when the project needs those dependency sets. `auth` adds Express, Zod, their TypeScript declarations, and the Node version required by Redweb's native-SQLite authentication path. `multiplayer` adds Redweb Client and Zod. Capabilities adjust the manifest without copying dashboard, chat, counter, or match-example source. Use an explicit `--template` only when you want a complete example walkthrough.

Run `npm test` for the real HTTP and lifecycle checks. Pass `--bare` only when you intentionally do not want the test directory, test scripts, or test-only coverage dependency; the runnable source, assets, build scripts, and development setup stay the same.
