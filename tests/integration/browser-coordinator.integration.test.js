'use strict';

const { main } = require('../../scripts/verify-browser-coverage');
const fs = require('node:fs');
const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');

// Real Chromium, HTTP/WebSockets, source builds and client tests. No replaced
// browser, process, compiler, filesystem or transport APIs.
test('installed-client browser measurement reports incomplete coverage as failure', async () => {
    const reportFile = path.resolve(__dirname, '../../coverage/browser-client/report.json');
    const previousId = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')).id : undefined;
    const started = Date.now();
    let failure;
    try { await main('client'); } catch (error) { failure = error; }
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    expect(report.id).toMatch(/^[\da-f]{8}-[\da-f-]{27}$/);
    expect(report.id).not.toBe(previousId);
    expect(Date.parse(report.startedAt)).toBeGreaterThanOrEqual(started);
    expect(Date.parse(report.endedAt)).toBeGreaterThanOrEqual(Date.parse(report.startedAt));
    expect(report.plainCases).toEqual(report.instrumentedCases);
    expect(report.plainCases.client.protocol.assertions).toBe(58);
    expect(report.plainCases.client.network.assertions).toBe(43);
    expect(report.integration.selection.serverActions).toBe(2);
    const incomplete = ['statements', 'branches', 'functions', 'lines'].some(metric => report.summary[metric].pct !== 100);
    expect(report.status).toBe(incomplete ? 'failed' : 'passed');
    if (incomplete) {
        expect(failure?.code).toBe('ERR_ASSERTION');
        expect(failure?.errors).toBeUndefined();
        expect(failure?.cause).toBeUndefined();
        expect(failure?.message).toMatch(/Generated browser .* coverage must be 100%/);
        expect(report.error).toBe(failure.message);
    } else expect(failure).toBeUndefined();
}, 300000);

// Explicit opt-in: ordinary registry-only CI has no linked source checkout or
// client development dependencies. The established source gate remains separate.
const sourceTest = process.env.REDWEB_VERIFY_CLIENT_SOURCE === '1' ? test : test.skip;
sourceTest('browser coordinator verifies the actual source-built client in both modes', async () => {
    // Use the actual CLI realm: native fs arrays and Jest VM arrays have distinct
    // prototypes. Do not weaken the source verifier's exact inventory assertion.
    await new VerificationWorkspace().run(async owner => {
        const output = await owner.command([path.resolve(__dirname, '../../scripts/verify-client-source-coverage.js')]);
        const report = JSON.parse(output);
        expect(report.status).toBe('passed');
        for (const metric of ['statements', 'branches', 'functions', 'lines']) {
            expect(report.coverage[metric].pct).toBe(100);
        }
    });
}, 300000);
