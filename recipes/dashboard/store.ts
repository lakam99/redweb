import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export interface Card { id: string; title: string; }
export interface Session { account: string; expires: number; }
export interface Credentials { salt: string; hash: string; }
export const MAX_CARDS = 100;
export const USERNAME = /^[a-z][a-z0-9_-]{2,31}$/;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

/** Recipe-local persistence. Every private query derives its owner from a live session. */
export class DashboardStore {
    private readonly db: DatabaseSync;
    private closed = false;

    constructor(filename: string) {
        this.db = new DatabaseSync(filename);
        try {
            this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 1000;');
            const version = this.db.prepare('PRAGMA user_version').get()!.user_version;
            if (version !== 0 && version !== 1) throw new Error('Unsupported dashboard database version.');
            this.db.exec(`
                BEGIN IMMEDIATE;
                CREATE TABLE IF NOT EXISTS accounts (
                    id TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL, epoch INTEGER NOT NULL DEFAULT 0
                ) STRICT;
                CREATE TABLE IF NOT EXISTS sessions (
                    token TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                    expires INTEGER NOT NULL
                ) STRICT;
                CREATE INDEX IF NOT EXISTS sessions_owner ON sessions(account);
                CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
                CREATE TABLE IF NOT EXISTS cards (
                    id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                    title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 80)
                ) STRICT;
                CREATE INDEX IF NOT EXISTS cards_owner ON cards(account);
                PRAGMA user_version = 1;
                COMMIT;
            `);
        } catch (error) { this.db.close(); throw error; }
    }

    provision(account: string, credentials: Credentials) {
        if (!USERNAME.test(account) || !/^[a-f0-9]{32}$/.test(credentials.salt) || !/^[a-f0-9]{128}$/.test(credentials.hash)) {
            throw new TypeError('Invalid account credentials.');
        }
        this.db.prepare('INSERT INTO accounts(id, salt, hash) VALUES (?, ?, ?)').run(account, credentials.salt, credentials.hash);
    }

    credentials(account: string): (Credentials & { epoch: number }) | undefined {
        return this.db.prepare('SELECT salt, hash, epoch FROM accounts WHERE id = ?').get(account) as unknown as (Credentials & { epoch: number }) | undefined;
    }

    issue(account: string, ttlMs: number, expectedEpoch?: number): string {
        if (!Number.isInteger(ttlMs) || ttlMs < 100 || ttlMs > 86400000) throw new RangeError('Session lifetime must be 100ms–24h.');
        return this.transaction(() => {
            if (expectedEpoch !== undefined && this.credentials(account)?.epoch !== expectedEpoch) throw new Error('Sign-out occurred during sign-in. Try again.');
            this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
            const count = this.db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE account = ?').get(account)!.count as number;
            if (count >= 32) throw new Error('Sign out existing sessions before signing in again.');
            const token = randomBytes(32).toString('base64url');
            this.db.prepare('INSERT INTO sessions(token, account, expires) VALUES (?, ?, ?)').run(digest(token), account, Date.now() + ttlMs);
            return token;
        });
    }

    session(token: string): Session | undefined {
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
        return this.db.prepare('SELECT account, expires FROM sessions WHERE token = ? AND expires > ?').get(digest(token), Date.now()) as unknown as Session | undefined;
    }

    list(token: string): Card[] {
        const { account } = this.requireSession(token);
        return this.db.prepare('SELECT id, title FROM cards WHERE account = ? ORDER BY rowid').all(account) as unknown as Card[];
    }

    add(token: string, title: string): string {
        if (typeof title !== 'string' || !title.trim() || title.length > 80 || /[\p{Cc}\p{Cf}]/u.test(title)) throw new TypeError('Invalid card title.');
        return this.transaction(() => {
            const { account } = this.requireSession(token);
            const count = this.db.prepare('SELECT COUNT(*) AS count FROM cards WHERE account = ?').get(account)!.count as number;
            if (count >= MAX_CARDS) throw new Error('Card limit reached.');
            this.db.prepare('INSERT INTO cards(id, account, title) VALUES (?, ?, ?)').run(randomUUID(), account, title.trim());
            return account;
        });
    }

    remove(token: string, id: string): string {
        return this.transaction(() => {
            const { account } = this.requireSession(token);
            this.db.prepare('DELETE FROM cards WHERE id = ? AND account = ?').run(id, account);
            return account;
        });
    }

    signOut(token: string): string | undefined {
        return this.transaction(() => {
            const session = this.session(token);
            if (!session) return undefined;
            this.db.prepare('DELETE FROM sessions WHERE account = ?').run(session.account);
            this.db.prepare('UPDATE accounts SET epoch = epoch + 1 WHERE id = ?').run(session.account);
            return session.account;
        });
    }

    close() { if (!this.closed) { this.closed = true; this.db.close(); } }

    private requireSession(token: string): Session {
        const session = this.session(token);
        if (!session) throw new Error('Session expired. Sign in again.');
        return session;
    }

    private transaction<T>(operation: () => T): T {
        this.db.exec('BEGIN IMMEDIATE');
        try { const result = operation(); this.db.exec('COMMIT'); return result; }
        catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
}
