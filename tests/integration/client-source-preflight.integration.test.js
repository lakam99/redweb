'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');

const command = path.resolve(__dirname, '../../scripts/verify-client-source-coverage.js');
const client = fs.realpathSync(path.join(path.dirname(require.resolve('redweb-client')), '..'));

test('the real client preflight resolves a checkout alias without starting tests or creating reports', () =>
    new VerificationWorkspace().run(async execution => {
        const alias = path.join(execution.directory, 'client');
        fs.symlinkSync(client, alias, 'junction');
        const reports = path.resolve(__dirname, '../../coverage/client-source');
        const before = fs.existsSync(reports) ? fs.readdirSync(reports).sort() : [];
        expect(await execution.command([command, '--check-client', alias])).toBe('Matching linked client checkout verified.\n');
        expect(fs.existsSync(reports) ? fs.readdirSync(reports).sort() : []).toEqual(before);
        expect(fs.readdirSync(execution.directory)).toEqual(['client']);
    }));

test('the real preflight rejects wrong linkage, missing checkouts and invalid arguments', () =>
    new VerificationWorkspace().run(async execution => {
        await expect(execution.command([command, '--check-client', execution.directory])).rejects.toThrow('differs');
        await expect(execution.command([command, '--check-client', path.join(execution.directory, 'missing')])).rejects.toThrow('ENOENT');
        await expect(execution.command([command, '--check-client'])).rejects.toThrow('Usage:');
        await expect(execution.command([command, '--other', client])).rejects.toThrow('Usage:');
    }));

test('a fresh linked checkout can pass preflight before its first build', () =>
    new VerificationWorkspace().run(async execution => {
        const root = execution.directory;
        const checkout = path.join(root, 'client');
        const scripts = path.join(root, 'scripts');
        const modules = path.join(root, 'node_modules');
        for (const directory of [checkout, scripts, modules]) fs.mkdirSync(directory);
        fs.writeFileSync(path.join(checkout, 'package.json'), JSON.stringify({ name: 'redweb-client', main: './dist/index.cjs' }));
        fs.symlinkSync(checkout, path.join(modules, 'redweb-client'), 'junction');
        fs.symlinkSync(path.resolve(__dirname, '../../scripts/lib'), path.join(scripts, 'lib'), 'junction');
        const local = path.join(scripts, path.basename(command));
        fs.copyFileSync(command, local);
        await expect(execution.command(['-p', "require.resolve('redweb-client')"])).rejects.toThrow('Cannot find module');
        expect(await execution.command([local, '--check-client', checkout])).toBe('Matching linked client checkout verified.\n');
        expect(fs.existsSync(path.join(checkout, 'dist'))).toBe(false);
        expect(fs.existsSync(path.join(root, 'coverage'))).toBe(false);
    }));
