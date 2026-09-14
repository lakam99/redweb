#!/usr/bin/env node
'use strict';

const { run } = require('../src/cli/run');
const { version } = require('../package.json');

run(process.argv.slice(2), process.cwd(), version).then(result => {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
});
