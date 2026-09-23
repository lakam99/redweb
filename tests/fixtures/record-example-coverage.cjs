'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

afterAll(() => {
    if (globalThis.__redwebApplicationCoverage__) {
        fs.writeFileSync(path.join(process.env.REDWEB_EXAMPLE_REPORTS, `${randomUUID()}.json`),
            JSON.stringify(globalThis.__redwebApplicationCoverage__), { flag: 'wx' });
    }
});
