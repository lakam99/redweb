'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');

// Real owned filesystem/resolution, explicit command and client-identity units.
test.each(['registry', 'candidate', 'invalid-report', 'invalid-count', 'changed-link', 'escaped-transport', 'client-failure'])
('packed dependency coordinator unit: %s', mode => new VerificationWorkspace().run(async owner => {
    const consumer = path.join(owner.directory, 'production-examples');
    const calls = [], checks = [];
    const evidence = { clientVersion: 'unit' };
    const verify = (_consumer, expected) => {
        checks.push(expected);
        if (mode === 'client-failure') throw new Error('client identity failed');
        return evidence;
    };
    const manifest = (directory, data) => {
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(data));
    };
    const execution = { command: async (args, options) => {
        calls.push({ args, options });
        if (calls.length === 1) {
            manifest(path.join(consumer, 'node_modules/redweb'), { name: 'redweb', version: '1.0.0' });
            if (mode === 'escaped-transport') {
                const outside = path.join(owner.directory, 'outside-ws');
                manifest(outside, { name: 'ws', version: '1.0.0' });
                fs.symlinkSync(outside, path.join(consumer, 'node_modules/ws'), 'junction');
            } else manifest(path.join(consumer, 'node_modules/ws'), { name: 'ws', version: '1.0.0' });
        }
        if (calls.length === 3 && mode === 'changed-link') {
            const link = path.join(consumer, 'probe-support/node_modules/ws');
            fs.unlinkSync(link); fs.writeFileSync(link, 'do not remove');
        }
        if (args.includes('add')) return JSON.stringify({ registration: { status: mode === 'invalid-report' ? 'complete' : 'pending' },
            created: mode === 'invalid-count' ? ['one'] : ['one', 'two'], test: `test-${args[2]}.js` });
        return 'unit command output';
    } };
    let verifyExampleDependencies;
    jest.isolateModules(() => {
        jest.doMock('../../scripts/lib/InstalledClient', () => ({ verifyInstalledClient: verify }));
        ({ verifyExampleDependencies } = require('../../scripts/lib/verify-example-dependencies'));
    });
    try {
        const candidate = mode === 'candidate' ? { manifest: () => ({ dependencies: { 'redweb-client': 'file:unit.tgz' },
            overrides: { redweb: { 'redweb-client': '$redweb-client' } } }), verify } : undefined;
        const result = verifyExampleDependencies('C:\\unit\\redweb.tgz', owner.directory, '4', { typescript: '5', ws: '8' }, execution, candidate);
        const errors = { 'invalid-report': 'addition report', 'invalid-count': 'addition report',
            'changed-link': 'transport link changed', 'escaped-transport': 'transport escaped', 'client-failure': 'client identity failed' };
        if (errors[mode]) await expect(result).rejects.toThrow(errors[mode]);
        else {
            const report = await result;
            expect(report.consumer).toBe(consumer); expect(report.clientEvidence).toBe(evidence);
            expect(report.withoutValidator).toBe('unit command output'); expect(report.withValidator).toBe('unit command output');
            report.verifyClient(evidence); expect(checks).toEqual([undefined, evidence, evidence]);
            expect(calls).toHaveLength(11);
            expect(calls[1].options.environment).toEqual({ NODE_ENV: 'production' });
            expect(calls[3].options.environment).toEqual({ NODE_ENV: 'development' });
            expect(calls[10].args).toEqual(['--test', 'test-page.js', 'test-component.js', 'test-socket-route.js']);
            const packageJson = JSON.parse(fs.readFileSync(path.join(consumer, 'package.json')));
            expect(packageJson.dependencies.redweb).toBe('file:C:/unit/redweb.tgz');
            expect(Boolean(packageJson.overrides)).toBe(mode === 'candidate');
        }
        for (const { args, options } of calls) {
            expect(options.rejectTruncatedOutput).toBe(true);
            expect(options.cwd).toBe(consumer);
            expect(options.timeoutMs).toBe(args[0] === 'probe.cjs' ? 90000 : 120000);
        }
        for (const [source, target] of [['scripts/realtime-harness.js', 'realtime-harness.js'],
            ['tests/helpers/network.js', 'network.js'], ['scripts/lib/verificationError.js', 'lib/verificationError.js'],
            ['scripts/lib/performProbeAction.js', 'lib/performProbeAction.js']]) {
            expect(fs.readFileSync(path.join(consumer, 'probe-support', target)))
                .toEqual(fs.readFileSync(path.resolve(__dirname, '../..', source)));
        }
        if (mode === 'changed-link') expect(fs.readFileSync(path.join(consumer, 'probe-support/node_modules/ws'), 'utf8')).toBe('do not remove');
    } finally { jest.dontMock('../../scripts/lib/InstalledClient'); jest.resetModules(); }
}));
