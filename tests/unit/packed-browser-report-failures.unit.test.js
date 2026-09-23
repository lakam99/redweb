'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const { isNativeError } = require('node:util/types');
const filename = path.resolve(__dirname, '../../scripts/lib/preservePackedBrowserReport.js');

// Explicit filesystem-boundary failures. The existing companion suite uses
// actual file/directory conflicts and verifies the bytes retained on disk.
test.each(['copy', 'write'].flatMap(phase => [undefined, null, false, 0, ''].map(value => [phase, value])))
('a falsy %s failure cannot produce a passed report: %p', (phase, value) => {
    const nativeRequire = createRequire(filename);
    const context = { module: { exports: {} }, require: name => name === 'node:fs' ? {
        existsSync: () => true,
        cpSync() { if (phase === 'copy') throw value; },
        writeFileSync() { if (phase === 'write') throw value; },
    } : nativeRequire(name) };
    vm.runInNewContext(createInstrumenter().instrumentSync(fs.readFileSync(filename, 'utf8'), filename), context, { filename });
    const report = { status: 'passed' };
    const failure = context.module.exports.preservePackedBrowserReport(report, 'unit-output', 'unit-coverage');
    expect(isNativeError(failure)).toBe(true);
    expect(failure.cause).toBe(value);
    expect(report.status).toBe('failed');
    expect(report.error).toBe(failure.message);
    if (process.argv.includes('--collectCoverageFrom=scripts/lib/preservePackedBrowserReport.js')) {
        const combined = createCoverageMap(globalThis.__coverage__ || {});
        combined.merge(context.__coverage__);
        globalThis.__coverage__ ||= {};
        globalThis.__coverage__[filename] = combined.fileCoverageFor(filename).toJSON();
    }
});
