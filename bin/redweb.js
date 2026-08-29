#!/usr/bin/env node
'use strict';

const path = require('path');
const ProjectInitializer = require('../src/cli/ProjectInitializer');
const { version } = require('../package.json');

const [command, target = '.', ...extra] = process.argv.slice(2);

if (command === 'init' && extra.length === 0) {
    const result = new ProjectInitializer(version).initialize(path.resolve(process.cwd(), target));
    console.log(`Redweb project ready in ${result.root}`);
    if (result.created.length) console.log(`Created: ${result.created.join(', ')}`);
    if (result.skipped.length) console.log(`Kept existing: ${result.skipped.join(', ')}`);
    console.log('Next: npm install && npm run dev');
} else {
    const stream = command === undefined || command === '--help' || command === '-h' ? process.stdout : process.stderr;
    stream.write('Usage: redweb init [directory]\n');
    if (stream === process.stderr) process.exitCode = 1;
}
