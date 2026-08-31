'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { listenerAddresses } = require('../../scripts/evaluation/process');
const { waitForListening } = require('../helpers/network');
const root = path.resolve(__dirname, '../..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('the unchanged seal CLI seals actual fixture evidence and refuses to overwrite it', async () => {
    const filename = path.join(root, 'scripts/evaluation/seal.js');
    const original = fs.readFileSync(filename, 'utf8');
    const before = hash(original);
    await new VerificationWorkspace().run(async owner => {
        const evidence = path.join(owner.directory, 'evidence');
        fs.mkdirSync(path.join(evidence, 'submission-1'), { recursive: true });
        for (const file of ['assigned-prompt.txt', 'discovery-prompt.txt', 'protocol.md', 'input-manifest.json',
            'redweb-candidate.tgz', 'DISCOVERY.md', 'submission-1/application.js']) {
            fs.writeFileSync(path.join(evidence, file), 'synthetic seal fixture: ' + file);
        }
        const reports = path.join(owner.directory, 'reports'); fs.mkdirSync(reports);
        const compiled = path.join(owner.directory, 'compiled.json');
        const instrumenter = createInstrumenter({ coverageVariable: '__redwebApplicationCoverage__',
            coverageGlobalScope: 'globalThis', coverageGlobalScopeFunc: false });
        fs.writeFileSync(compiled, JSON.stringify({ [filename]: instrumenter.instrumentSync(original, filename) }));
        const environment = {
            NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ${JSON.stringify(path.join(__dirname, '../helpers/instrument-selected.cjs'))}`,
            REDWEB_COVERAGE_COMPILED: compiled, REDWEB_APPLICATION_COVERAGE_DIRECTORY: reports,
        };
        const output = await owner.command([filename, evidence], { environment });
        const record = JSON.parse(output);
        const sealed = fs.readFileSync(path.join(evidence, 'seal.json'), 'utf8');
        expect(JSON.parse(sealed)).toEqual(record);
        expect(record.checkerSha256['scripts/evaluation/seal.js']).toBe(before);
        expect(record.evidenceSha256['submission-1/application.js']).toBe(hash(fs.readFileSync(path.join(evidence, 'submission-1/application.js'))));
        // This tool seals bytes; it does not validate the synthetic archive.
        const files = fs.readdirSync(reports);
        expect(files).toHaveLength(1);
        const measured = JSON.parse(fs.readFileSync(path.join(reports, files[0]), 'utf8'));
        expect(Object.keys(measured)).toEqual([filename]);
        const expected = instrumenter.lastFileCoverage();
        for (const field of ['statementMap', 'fnMap', 'branchMap']) {
            expect(measured[filename][field]).toEqual(JSON.parse(JSON.stringify(expected[field])));
        }
        if (process.argv.includes('--collectCoverageFrom=scripts/evaluation/seal.js')) {
            const map = createCoverageMap(globalThis.__coverage__ || {}); map.merge(measured);
            globalThis.__coverage__ ||= {}; globalThis.__coverage__[filename] = map.fileCoverageFor(filename).toJSON();
        }
        await expect(owner.command([filename, evidence])).rejects.toThrow('EEXIST');
        expect(fs.readFileSync(path.join(evidence, 'seal.json'), 'utf8')).toBe(sealed);
    });
    expect(hash(fs.readFileSync(filename))).toBe(before);
}, 30000);

(process.platform === 'win32' ? test : test.skip)('listener inspection observes the actual Windows loopback interface', async () => {
    const server = net.createServer();
    try {
        server.listen(0, '127.0.0.1'); await waitForListening(server);
        expect(listenerAddresses(server.address().port)).toEqual(['127.0.0.1']);
    } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}, 20000);

(process.platform !== 'win32' ? test : test.skip)('listener inspection refuses unsupported native platforms', () => {
    expect(() => listenerAddresses(12345)).toThrow('currently requires Windows');
});
