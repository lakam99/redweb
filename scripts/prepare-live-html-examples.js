'use strict';

const fs = require('fs');
const path = require('path');

const examples = path.resolve(__dirname, '..', 'examples', 'live-html');
fs.readdirSync(examples)
    .filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts'))
    .forEach(file => {
        const output = path.join(examples, file.replace(/\.ts$/, '.js'));
        const compiled = fs.readFileSync(output, 'utf8');
        fs.writeFileSync(output, compiled.replaceAll('require("redweb")', "require('../..')"));
    });
