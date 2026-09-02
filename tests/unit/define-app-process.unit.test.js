'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const { withTimeout } = require('../helpers/network');

const filename = path.resolve(__dirname, '../../src/Application.js');

// Unit-only process boundary: never terminate Jest. Native process behavior is
// independently tested in define-app-process.integration.test.js.
test.each(['signal', 'close', 'error', 'failed-cleanup'])('process ownership boundary: %s', async mode => {
    let exited, disposed = 0;
    const exit = new Promise(resolve => { exited = resolve; });
    const processBoundary = Object.assign(new EventEmitter(), { exit: () => exited(), exitCode: undefined });
    const context = { module: { exports: {} }, require: createRequire(filename),
        process: processBoundary, AbortController, setTimeout, clearTimeout };
    vm.runInNewContext(createInstrumenter().instrumentSync(fs.readFileSync(filename, 'utf8'), filename), context, { filename });
    class Resource {
        onInit() {}
        onShutdown() { disposed++; if (mode === 'failed-cleanup') throw new Error('unit cleanup failure'); }
    }
    const app = context.module.exports.defineApp({ port: 0, bind: '127.0.0.1', logger: null,
        services: [Resource], startupTimeoutMs: 2000, shutdownTimeoutMs: 100 });
    try {
        await app.run();
        if (mode === 'error') app.server.emit('error', new Error('unit listener failure'));
        else if (mode === 'close') {
            const closed = new Promise(resolve => app.server.once('close', resolve));
            app.server.close();
            await closed;
        } else {
            processBoundary.emit('SIGTERM');
            processBoundary.emit('SIGINT');
        }
        if (mode === 'failed-cleanup') {
            await expect(app.shutdown()).rejects.toThrow('shutdown failed');
            expect(processBoundary.listenerCount('SIGINT')).toBe(1);
            await withTimeout(exit, 'forced process exit', 1000);
        } else {
            await app.shutdown();
            expect(processBoundary.listenerCount('SIGINT')).toBe(0);
        }
        expect(processBoundary.exitCode).toBe(['error', 'failed-cleanup'].includes(mode) ? 1 : undefined);
        expect(disposed).toBe(1);
        expect(app.server.listening).toBe(false);
    } finally {
        await app.shutdown().catch(() => {});
        // Application belongs to the default runtime coverage inventory too.
        if (!process.argv.some(argument => argument.startsWith('--collectCoverageFrom'))
            || process.argv.includes('--collectCoverageFrom=src/Application.js')) {
            const combined = createCoverageMap(globalThis.__coverage__ || {});
            combined.merge(context.__coverage__);
            globalThis.__coverage__ ||= {};
            globalThis.__coverage__[filename] = combined.fileCoverageFor(filename).toJSON();
        }
    }
});
