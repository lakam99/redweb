'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { verifyExampleDependencies } = require('../../scripts/lib/verify-example-dependencies');
const { npmEntrypoint } = require('../../scripts/evaluation/process');

test('actual packed production counter and chat, then installed generated TypeScript additions', () => new VerificationWorkspace().run(async owner => {
    const root = path.resolve(__dirname, '../..');
    const metadata = require('../../package.json');
    const packed = JSON.parse(await owner.command([npmEntrypoint(), 'pack', '--json', '--pack-destination', owner.directory],
        { cwd: root, rejectTruncatedOutput: true }));
    const result = await verifyExampleDependencies(path.join(owner.directory, packed[0].filename), owner.directory,
        metadata.devDependencies.zod, { typescript: metadata.devDependencies.typescript, ws: metadata.dependencies.ws }, owner);
    expect(result.withoutValidator).toContain('Core and counter passed without Zod or TypeScript');
    expect(result.withValidator).toContain('Packed chat, development inspection and refresh resources passed');
    expect(result.additions).toContain('Packed page/component/socket-route additions passed');
    const fromConsumer = createRequire(path.join(result.consumer, 'package.json'));
    const fromServer = createRequire(fromConsumer.resolve('redweb/package.json'));
    const support = path.join(result.consumer, 'probe-support/node_modules/ws');
    expect(fs.realpathSync(support)).toBe(fs.realpathSync(path.dirname(fromServer.resolve('ws/package.json'))));
    expect(result.clientEvidence.candidateOnly).toBe(false);
    result.verifyClient(result.clientEvidence);
}), 1500000);
