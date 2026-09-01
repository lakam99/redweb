import express, { type ErrorRequestHandler } from 'express';
import { mkdirSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { dirname, resolve } from 'node:path';
import { page, start, type LivePageRequestContext } from 'redweb';
import { DashboardAuth, sessionToken } from './auth';
import { Cards, PrivateCards } from './cards';
import { DashboardStore } from './store';
import { runApp } from './run-app';

export interface DashboardOptions { port?: number; database?: string; origin?: string; sessionLifetimeMs?: number; }

export function databasePath() { return resolve(process.env.DASHBOARD_DATABASE ?? 'data/dashboard.sqlite'); }

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Development is loopback-only, so its equivalent browser hostnames share one trust boundary. */
export function allowsDashboardOrigin(candidate: string | undefined, expected: string, configured: boolean, host?: string) {
    if (!candidate) return false;
    if (configured) return candidate === expected;
    if (!host || /[\/@?#\\]/.test(host)) return false;
    try {
        const actual = new URL(candidate);
        const local = new URL(expected);
        const target = new URL(`http://${host}`);
        return actual.origin === candidate && actual.protocol === 'http:'
            && actual.origin === target.origin && actual.port === local.port
            && LOOPBACK_HOSTS.has(actual.hostname);
    } catch { return false; }
}

export function createApp(options: DashboardOptions = {}) {
    const port = options.port ?? Number(process.env.PORT ?? 8181);
    const configuredOrigin = options.origin ?? process.env.DASHBOARD_ORIGIN;
    if (configuredOrigin && (!/^https?:$/.test(new URL(configuredOrigin).protocol) || new URL(configuredOrigin).origin !== configuredOrigin)) {
        throw new Error('DASHBOARD_ORIGIN must be an exact HTTP(S) origin without a path.');
    }
    if (process.env.NODE_ENV === 'production' && !configuredOrigin?.startsWith('https://')) throw new Error('Production requires an explicit HTTPS DASHBOARD_ORIGIN.');
    const filename = options.database ?? databasePath();
    mkdirSync(dirname(filename), { recursive: true });
    const store = new DashboardStore(filename);
    try {
    const cards = new PrivateCards(store);
    const auth = new DashboardAuth(store, options.sessionLifetimeMs);
    const app = express();
    app.disable('x-powered-by');
    app.use(express.urlencoded({ extended: false, limit: '4kb', parameterLimit: 4 }));
    const invalidBody: ErrorRequestHandler = (_error, _request, response, _next) => {
        if (!response.destroyed) response.status(400).send('Invalid form submission.');
    };
    app.use(invalidBody);
    const origin = () => configuredOrigin ?? `http://127.0.0.1:${(server.server.address() as { port: number }).port}`;
    const allowsOrigin = (candidate: string | undefined, request: IncomingMessage) =>
        allowsDashboardOrigin(candidate, origin(), Boolean(configuredOrigin), request.headers.host);

    @page('/login', { live: false, css: 'app.css', head: { title: 'Sign in · Your cards' } })
    class Login {
        render() {
            return <main class="home"><h1>Your private workspace</h1>
                <p>Sign in with the credentials created by your administrator.</p>
                <form method="post" action="/login">
                    <label for="account">Account</label><input id="account" name="account" autocomplete="username" required />
                    <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required />
                    <button type="submit">Sign in</button>
                </form>
            </main>;
        }
    }

    @page('/', { css: 'app.css', authorize: context => cards.allowed(context), head: { title: 'Your cards' } })
    class Dashboard {
        private readonly workspace = new Cards(cards);
        render(context: LivePageRequestContext) {
            return <main class="home"><header><div><h1>Your cards</h1><p>Signed in as {context.principal}</p></div>
                <form method="post" action="/logout"><button type="submit">Sign out all sessions</button></form>
            </header>{this.workspace}<p>Open another tab to see your changes instantly.</p></main>;
        }
    }

    auth.mount(app, origin, allowsOrigin, account => server.revoke(account));
    const server = start([Login, Dashboard], {
        server: app, port, bind: configuredOrigin ? '0.0.0.0' : '127.0.0.1', logger: null, templateRoot: __dirname,
        origins: allowsOrigin,
        authenticate: request => request.method === 'GET' && request.url?.split('?')[0] === '/login'
            ? true : store.session(sessionToken(request.headers.cookie))?.account,
    });
    let closing: Promise<void> | undefined;
    const shutdown = () => {
        auth.close();
        if (!closing) {
            closing = server.shutdown().finally(() => store.close());
        }
        return closing;
    };
    server.server.once('error', () => { void shutdown().catch(() => {}); });
    return {
        server: server.server,
        shutdown,
    };
    } catch (error) { store.close(); throw error; }
}

if (require.main === module) {
    const app = runApp(createApp);
    app?.server.once('listening', () => console.log(`Dashboard: ${process.env.DASHBOARD_ORIGIN ?? `http://127.0.0.1:${(app.server.address() as { port: number }).port}`}/login`));
}
