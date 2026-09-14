'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');

/** Fingerprint the actual client resolved by the isolated installed server. */
function verifyInstalledClient(consumer, expected) {
    const root = fs.realpathSync(consumer);
    const requireFromRedweb = createRequire(path.join(root, 'node_modules/redweb/package.json'));
    const entry = fs.realpathSync(requireFromRedweb.resolve('redweb-client/live-html'));
    assert.ok(entry.startsWith(root + path.sep), 'Packed Redweb must resolve its client inside the isolated consumer');
    const client = path.dirname(path.dirname(entry));
    const metadata = JSON.parse(fs.readFileSync(path.join(client, 'package.json'), 'utf8'));
    assert.equal(metadata.name, 'redweb-client', 'Installed package must contain redweb-client');
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    const lockKey = path.relative(root, client).replaceAll('\\', '/');
    const bundles = Object.fromEntries(['index.js', 'index.cjs', 'live-html.js', 'live-html.cjs'].map(name => {
        const filename = fs.realpathSync(path.join(client, 'dist', name));
        assert.ok(filename.startsWith(root + path.sep), 'Every client bundle must stay inside the isolated consumer');
        return [name, createHash('sha256').update(fs.readFileSync(filename)).digest('hex')];
    }));
    assert.equal(entry, fs.realpathSync(path.join(client, 'dist/live-html.cjs')), 'Live HTML export must resolve to the fingerprinted bundle');
    assert.equal(fs.realpathSync(requireFromRedweb.resolve('redweb-client')), fs.realpathSync(path.join(client, 'dist/index.cjs')),
        'Root client export must resolve to the fingerprinted bundle');
    const report = { candidateOnly: false, integrity: lock.packages[lockKey]?.integrity,
        resolved: lock.packages[lockKey]?.resolved, clientVersion: metadata.version,
        resolvedFrom: 'installed redweb package', bundles };
    if (expected) assert.deepEqual(report, expected, 'Installed client changed during verification');
    return report;
}

module.exports = { verifyInstalledClient };
