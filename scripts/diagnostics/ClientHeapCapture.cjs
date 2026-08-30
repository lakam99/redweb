'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const v8 = require('node:v8');
const { randomUUID, createHash } = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const MAX_BYTES = 64 * 1024 * 1024;
const phases = ['warm', 'storm-5'];

// Local-only diagnostic. The byte limit bounds disk output, NOT V8's native
// snapshot-generation memory/pause. The coordinator owns the deadline/child.
class ClientHeapCapture {
    constructor(directory, maxBytes = MAX_BYTES) {
        assert(path.isAbsolute(directory));
        assert(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= MAX_BYTES);
        this.directory = directory;
        this.maxBytes = maxBytes;
        this.identity = `${process.pid}:${randomUUID()}`;
        this.next = 0;
        this.failed = false;
    }

    async capture(phase) {
        assert(!this.failed && phase === phases[this.next], 'Invalid heap capture sequence');
        this.failed = true; // Failure or overlapping capture cannot reuse this session.
        const filename = `client-${phase}.heapsnapshot`;
        let bytes = 0;
        const hash = createHash('sha256');
        const maxBytes = this.maxBytes;
        const limiter = new Transform({ transform(chunk, encoding, done) {
            bytes += chunk.length;
            if (bytes > maxBytes) return done(new Error('Heap capture output limit exceeded'));
            hash.update(chunk);
            done(null, chunk);
        } });
        // Open exclusively BEFORE requesting V8's synchronous generation.
        const file = await fs.promises.open(path.join(this.directory, filename), 'wx', 0o600);
        try {
            await pipeline(v8.getHeapSnapshot(), limiter, file.createWriteStream());
        } finally { await file.close(); }
        this.next++;
        this.failed = false;
        return { identity: this.identity, pid: process.pid, node: process.version, v8: process.versions.v8,
            phase, filename, bytes, sha256: hash.digest('hex') };
    }
}

module.exports = { ClientHeapCapture, MAX_BYTES };
