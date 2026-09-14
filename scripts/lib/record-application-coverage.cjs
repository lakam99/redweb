'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Preloaded only by the test runner; inherited by actual Node test/CLI children.
process.once('exit', () => {
    if (globalThis.__redwebApplicationCoverage__) {
        fs.writeFileSync(path.join(process.env.REDWEB_APPLICATION_COVERAGE_DIRECTORY,
            `${process.pid}-${randomUUID()}.json`), JSON.stringify(globalThis.__redwebApplicationCoverage__));
    }
});
