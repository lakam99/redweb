'use strict';

// Test-only original-source instrumentation. Keep the real CLI filename,
// require.main, dependencies and filesystem paths; never rewrite frozen files.
const fs = require('node:fs');
const Module = require('node:module');
const compiled = JSON.parse(fs.readFileSync(process.env.REDWEB_COVERAGE_COMPILED, 'utf8'));
const original = Module._extensions['.js'];
Module._extensions['.js'] = (module, filename) => {
    if (Object.hasOwn(compiled, filename)) return module._compile(compiled[filename], filename);
    return original(module, filename);
};
require('../../scripts/lib/record-application-coverage.cjs');
