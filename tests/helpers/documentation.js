'use strict';

const fs = require('fs');
const path = require('path');

function copyDocumentationSource(root, target) {
    for (const file of [
        'package.json', 'README.md', 'docs', 'recipes', 'examples/live-html', 'index.d.ts', 'client.d.ts',
        'contract.d.ts', 'jsx-runtime.d.ts', 'jsx-dev-runtime.d.ts', 'scripts/generate-docs.js',
        'src/docs/Documentation.js', 'src/cli/templates.js',
    ]) {
        fs.mkdirSync(path.dirname(path.join(target, file)), { recursive: true });
        fs.cpSync(path.join(root, file), path.join(target, file), { recursive: true });
    }
}

module.exports = { copyDocumentationSource };
