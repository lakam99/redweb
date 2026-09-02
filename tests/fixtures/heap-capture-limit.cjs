'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ClientHeapCapture } = require('../../scripts/diagnostics/ClientHeapCapture.cjs');

// Snapshot only this small owned process, never the surrounding Jest heap.
(async () => {
    const directory = process.argv[2];
    const capture = new ClientHeapCapture(directory, 1);
    const file = path.join(directory, 'client-warm.heapsnapshot');
    await assert.rejects(capture.capture('warm'), /Heap capture output limit exceeded/);
    await assert.rejects(capture.capture('warm'), /Invalid heap capture sequence/);
    assert.equal(fs.statSync(file).size, 0);
    await assert.rejects(new ClientHeapCapture(directory).capture('warm'), /EEXIST/);
    assert.equal(fs.statSync(file).size, 0);
    process.stdout.write('Capture limit, poisoned session and exclusive output verified.\n');
})().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
