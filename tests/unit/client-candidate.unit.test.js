'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ClientCandidate } = require('../../scripts/lib/ClientCandidate');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');

// Filesystem-only fingerprint/ownership units. Actual npm extraction is covered
// by the independently installed consumer gate, not by these synthetic bytes.
async function fixture(operation) {
    await new VerificationWorkspace().run(async execution => {
        const archive = path.join(execution.directory, 'client.tgz');
        fs.writeFileSync(archive, 'fingerprint fixture');
        const candidate = new ClientCandidate(archive);
        const consumer = path.join(execution.directory, 'consumer');
        const client = path.join(consumer, 'node_modules/redweb-client');
        fs.mkdirSync(path.join(client, 'dist'), { recursive: true });
        fs.mkdirSync(path.join(consumer, 'node_modules/redweb'), { recursive: true });
        fs.writeFileSync(path.join(consumer, 'node_modules/redweb/package.json'), '{}');
        fs.writeFileSync(path.join(client, 'package.json'), JSON.stringify({ name: 'redweb-client', version: '0.1.0',
            exports: { '.': './dist/index.cjs', './live-html': './dist/live-html.cjs' } }));
        for (const name of ['index.js', 'index.cjs', 'live-html.js', 'live-html.cjs']) fs.writeFileSync(path.join(client, 'dist', name), '// candidate');
        fs.writeFileSync(path.join(consumer, 'package-lock.json'), JSON.stringify({ packages: {
            'node_modules/redweb-client': { integrity: candidate.integrity },
        } }));
        await operation({ candidate, consumer, client, archive, directory: execution.directory });
    });
}

test('records candidate-only provenance from the server package and exact npm integrity', () => fixture(({ candidate, consumer }) => {
    expect(candidate.manifest()).toEqual({ dependencies: { 'redweb-client': 'file:' + candidate.filename.replaceAll('\\', '/') },
        overrides: { 'redweb-client': '$redweb-client' } });
    const report = candidate.verify(consumer);
    expect(candidate.verify(consumer, report)).toEqual(report);
    expect(report.candidateOnly).toBe(true);
    expect(report.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.integrity).toBe(candidate.integrity);
    expect(report.clientVersion).toBe('0.1.0');
    expect(Object.keys(report.bundles)).toEqual(['index.js', 'index.cjs', 'live-html.js', 'live-html.cjs']);
}));

test('rejects installed bundle changes even when lock integrity is unchanged', () => fixture(({ candidate, consumer, client }) => {
    const initial = candidate.verify(consumer);
    fs.appendFileSync(path.join(client, 'dist/index.js'), '\n// changed installed bytes');
    expect(() => candidate.verify(consumer, initial)).toThrow('changed during verification');
}));

test('checks secondary bundles even when the exported CommonJS entry stays inside', () => fixture(({ candidate, consumer, client, directory }) => {
    fs.mkdirSync(path.join(client, 'safe'));
    fs.copyFileSync(path.join(client, 'dist/live-html.cjs'), path.join(client, 'safe/live-html.cjs'));
    const manifest = path.join(client, 'package.json');
    const metadata = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    metadata.exports['./live-html'] = './safe/live-html.cjs';
    fs.writeFileSync(manifest, JSON.stringify(metadata));
    const outside = path.join(directory, 'outside-dist');
    fs.renameSync(path.join(client, 'dist'), outside);
    fs.symlinkSync(outside, path.join(client, 'dist'), 'junction');
    expect(() => candidate.verify(consumer)).toThrow('Every candidate bundle');
}));

test('rejects directories, non-tarball paths and changed candidate bytes', () => fixture(({ candidate, archive, consumer, directory }) => {
    expect(() => new ClientCandidate(directory)).toThrow('npm tarball');
    const other = path.join(directory, 'client.txt');
    fs.writeFileSync(other, 'not selected');
    expect(() => new ClientCandidate(other)).toThrow('npm tarball');
    fs.appendFileSync(archive, 'changed');
    expect(() => candidate.verify(consumer)).toThrow('changed during verification');
}));

test.each([{}, { 'node_modules/redweb-client': { integrity: 'different' } }])('rejects mismatched or absent lock integrity', packages =>
    fixture(({ candidate, consumer }) => {
        fs.writeFileSync(path.join(consumer, 'package-lock.json'), JSON.stringify({ packages }));
        expect(() => candidate.verify(consumer)).toThrow('exact supplied tarball');
    }));

test('rejects an archive installed with a different package identity', () => fixture(({ candidate, consumer, client }) => {
    const filename = path.join(client, 'package.json');
    const metadata = JSON.parse(fs.readFileSync(filename, 'utf8'));
    metadata.name = 'other';
    fs.writeFileSync(filename, JSON.stringify(metadata));
    expect(() => candidate.verify(consumer)).toThrow('must contain redweb-client');
}));

test.each(['.', './live-html'])('rejects %s exports pointing at a different unmeasured entry', entry => fixture(({ candidate, consumer, client }) => {
    const filename = path.join(client, 'package.json');
    const metadata = JSON.parse(fs.readFileSync(filename, 'utf8'));
    fs.writeFileSync(path.join(client, 'dist/other.cjs'), '// unmeasured');
    metadata.exports[entry] = './dist/other.cjs';
    fs.writeFileSync(filename, JSON.stringify(metadata));
    expect(() => candidate.verify(consumer)).toThrow('fingerprinted bundle');
}));

test('rejects client resolution escaping the isolated consumer via a junction', () => fixture(({ candidate, consumer, client, directory }) => {
    const outside = path.join(directory, 'external-client');
    fs.renameSync(client, outside);
    fs.symlinkSync(outside, client, 'junction');
    expect(() => candidate.verify(consumer)).toThrow('inside the isolated consumer');
}));
