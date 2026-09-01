import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { credentials } from './auth';
import { databasePath } from './app';
import { DashboardStore, USERNAME } from './store';

async function main() {
    const account = process.argv[2];
    if (!account || !USERNAME.test(account) || process.argv.length !== 3) throw new Error('Usage: npm run add-user -- alice (3–32 lowercase letters, digits, _ or -; starts with a letter).');
    const filename = databasePath();
    mkdirSync(dirname(filename), { recursive: true });
    const store = new DashboardStore(filename);
    try {
        const password = randomBytes(24).toString('base64url');
        store.provision(account, await credentials(password));
        console.log(`Created ${account}. Store this password safely; it is displayed only once:\n${password}`);
    } finally { store.close(); }
}

void main().catch(error => { console.error(error.message); process.exitCode = 1; });
