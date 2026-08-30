'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');

const digest = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);

/** Explicit local tarball verification, never an implicit registry substitution. */
class ClientCandidate {
    constructor(filename) {
        this.filename = fs.realpathSync(filename);
        assert.ok(fs.statSync(this.filename).isFile() && this.filename.endsWith('.tgz'), 'Client candidate must be an npm tarball');
        const bytes = fs.readFileSync(this.filename);
        this.sha256 = digest(bytes);
        this.integrity = 'sha512-' + digest(bytes, 'sha512', 'base64');
    }

    manifest() {
        return { dependencies: { 'redweb-client': 'file:' + this.filename.replaceAll('\\', '/') },
            overrides: { 'redweb-client': '$redweb-client' } };
    }

    verify(consumer, expected) {
        assert.equal(digest(fs.readFileSync(this.filename)), this.sha256, 'Client candidate changed during verification');
        const root = fs.realpathSync(consumer);
        const requireFromRedweb = createRequire(path.join(root, 'node_modules/redweb/package.json'));
        const entry = fs.realpathSync(requireFromRedweb.resolve('redweb-client/live-html'));
        assert.ok(entry.startsWith(root + path.sep), 'Packed Redweb must resolve its client inside the isolated consumer');
        const client = path.dirname(path.dirname(entry));
        const metadata = JSON.parse(fs.readFileSync(path.join(client, 'package.json'), 'utf8'));
        assert.equal(metadata.name, 'redweb-client', 'Candidate must contain redweb-client');
        const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
        const lockKey = path.relative(root, client).replaceAll('\\', '/');
        assert.equal(lock.packages[lockKey]?.integrity, this.integrity, 'Installed client must match the exact supplied tarball');
        const bundles = Object.fromEntries(['index.js', 'index.cjs', 'live-html.js', 'live-html.cjs'].map(name => {
            const filename = fs.realpathSync(path.join(client, 'dist', name));
            assert.ok(filename.startsWith(root + path.sep), 'Every candidate bundle must stay inside the isolated consumer');
            return [name, digest(fs.readFileSync(filename))];
        }));
        assert.equal(entry, fs.realpathSync(path.join(client, 'dist/live-html.cjs')), 'Live HTML export must resolve to the fingerprinted bundle');
        assert.equal(fs.realpathSync(requireFromRedweb.resolve('redweb-client')), fs.realpathSync(path.join(client, 'dist/index.cjs')),
            'Root client export must resolve to the fingerprinted bundle');
        const report = { candidateOnly: true, archiveSha256: this.sha256, integrity: this.integrity,
            clientVersion: metadata.version, resolvedFrom: 'installed redweb package', bundles };
        if (expected) assert.deepEqual(report, expected, 'Installed client candidate changed during verification');
        return report;
    }
}

module.exports = { ClientCandidate };
