'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { verifyInstalledClient } = require('./InstalledClient');

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
        const installed = verifyInstalledClient(consumer);
        assert.equal(installed.integrity, this.integrity, 'Installed client must match the exact supplied tarball');
        const report = { ...installed, candidateOnly: true, archiveSha256: this.sha256 };
        if (expected) assert.deepEqual(report, expected, 'Installed client candidate changed during verification');
        return report;
    }
}

module.exports = { ClientCandidate };
