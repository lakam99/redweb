const fs = require('node:fs');
const path = require('node:path');

// Keep runtime assets beside the compiled classes. Production needs only dist/ and dependencies.
fs.cpSync('src', 'dist', {
    recursive: true,
    filter: file => fs.statSync(file).isDirectory() || ['.css', '.html'].includes(path.extname(file)),
});
