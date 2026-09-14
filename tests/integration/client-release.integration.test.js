'use strict';

const fs = require('fs');
const path = require('path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { npmEntrypoint } = require('../../scripts/evaluation/process');
const { projectFiles } = require('../../src/cli/templates');

// Explicit opt-in: normal registry-only CI need not have the sibling client checkout.
const verify = process.env.REDWEB_VERIFY_CLIENT_RELEASE === '1' ? test : test.skip;
verify('the packed client installs independently and interoperates with released Redweb and patched Express', async () => {
    const clientRoot = path.resolve(__dirname, '../../../redweb-client');
    const version = JSON.parse(fs.readFileSync(path.join(clientRoot, 'package.json'), 'utf8')).version;
    await new VerificationWorkspace().run(async owner => {
        const npm = npmEntrypoint();
        const packed = JSON.parse(await owner.command([npm, 'pack', '--json', '--pack-destination', owner.directory], { cwd: clientRoot, timeoutMs: 55000 }));
        expect(packed).toHaveLength(1);
        expect(packed[0].version).toBe(version);
        expect(packed[0].files.map(file => file.path)).toContain('CHANGELOG.md');
        const tarball = path.join(owner.directory, packed[0].filename);
        const generated = JSON.parse(projectFiles('0.14.0').find(file => file.path === 'package.json').content);
        const consumer = path.join(owner.directory, 'consumer');
        fs.mkdirSync(consumer);
        fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ private: true,
            // The published baseline deliberately proves compatibility without a core checkout.
            dependencies: { redweb: '0.14.0', 'redweb-client': `file:${tarball}`, ws: '8.21.3' },
            overrides: generated.overrides,
        }));
        fs.copyFileSync(path.join(__dirname, '../fixtures/published-client-consumer.cjs'), path.join(consumer, 'verify.cjs'));
        await owner.command([npm, 'install', '--ignore-scripts'], { cwd: consumer, timeoutMs: 55000 });
        const output = await owner.command(['verify.cjs', version], { cwd: consumer, timeoutMs: 15000 });
        expect(output).toContain('PASS: isolated package exports, terminal replies, HTTP forms and qs 6.16.0');
        const audit = JSON.parse(await owner.command([npm, 'audit', '--omit=dev', '--json'], { cwd: consumer, timeoutMs: 55000 }));
        expect(audit.metadata.vulnerabilities.total).toBe(0);
    });
}, 180000); // Work-completion deadlines, not a static observation window.
