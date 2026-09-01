import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Application, Request, Response } from 'express';
import { DashboardStore, USERNAME, type Credentials } from './store';

const COOKIE = 'redweb_dashboard';
const DUMMY: Credentials = { salt: '00'.repeat(16), hash: '00'.repeat(64) };

export function sessionToken(cookie: string | undefined): string {
    const matches = (cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${COOKIE}=`));
    const token = matches.length === 1 ? matches[0].slice(COOKIE.length + 1) : '';
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '';
}

const passwordHash = promisify(scrypt);

export async function credentials(password: string): Promise<Credentials> {
    if (typeof password !== 'string' || password.length < 16 || password.length > 128) throw new TypeError('Use a password of 16–128 characters.');
    const salt = randomBytes(16).toString('hex');
    return { salt, hash: (await passwordHash(password, salt, 64) as Buffer).toString('hex') };
}

/** Bounded asynchronous password work; neither proxy headers nor browser input establish identity. */
export class DashboardAuth {
    private active = 0;
    private closed = false;
    private readonly attempts = new Map<string, { count: number; expires: number }>();

    constructor(private readonly store: DashboardStore, private readonly ttlMs = 3600000) {
        if (!Number.isInteger(ttlMs) || ttlMs < 100 || ttlMs > 86400000) throw new RangeError('Invalid session lifetime.');
    }

    async login(ip: string, account: unknown, password: unknown): Promise<string | undefined> {
        if (this.closed) return undefined;
        const now = Date.now();
        for (const [key, entry] of this.attempts) if (entry.expires <= now) this.attempts.delete(key);
        let attempt = this.attempts.get(ip);
        if (!attempt) {
            if (this.attempts.size >= 1024) return undefined;
            attempt = { count: 0, expires: now + 60000 };
            this.attempts.set(ip, attempt);
        }
        if (++attempt.count > 10 || this.active >= 4) return undefined;
        if (typeof account !== 'string' || !USERNAME.test(account) || typeof password !== 'string' || password.length < 16 || password.length > 128) return undefined;
        this.active++;
        try {
            const stored = this.store.credentials(account);
            const expected = stored ?? DUMMY;
            const actual = await passwordHash(password, expected.salt, 64) as Buffer;
            if (this.closed) return undefined;
            if (!timingSafeEqual(actual, Buffer.from(expected.hash, 'hex')) || !stored) return undefined;
            return this.store.issue(account, this.ttlMs, stored.epoch);
        } finally { this.active--; }
    }

    close() { this.closed = true; this.attempts.clear(); }

    mount(app: Application, origin: () => string, allowsOrigin: (candidate: string | undefined) => boolean, revoke: (account: string) => Promise<unknown>) {
        const cookie = (token: string) => `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? Math.ceil(this.ttlMs / 1000) : 0}${origin().startsWith('https:') ? '; Secure' : ''}`;
        const post = (route: string, handler: (request: Request, response: Response) => Promise<void>) => {
            app.post(route, (request, response) => {
                response.set('Cache-Control', 'private, no-store');
                if (!allowsOrigin(request.get('origin'))) { response.status(403).send('This form must be submitted from this site.'); return; }
                void handler(request, response).catch(() => response.status(503).send('Unable to complete the request. Try again later.'));
            });
        };
        post('/login', async (request, response) => {
            const token = await this.login(String(request.socket.remoteAddress), request.body?.account, request.body?.password);
            if (!token) { response.status(401).send('Unable to sign in. Check your credentials or try again later.'); return; }
            response.setHeader('Set-Cookie', cookie(token));
            response.redirect(303, '/');
        });
        post('/logout', async (request, response) => {
            const account = this.store.signOut(sessionToken(request.headers.cookie));
            response.setHeader('Set-Cookie', cookie(''));
            if (account) await revoke(account);
            response.redirect(303, '/login');
        });
    }
}
