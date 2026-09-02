'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const script = path.resolve(__dirname, '../../recipes/shared/copy-assets.cjs');

test('shipped asset copier preserves compiled code and copies only HTML/CSS through nested directories', () =>
    new VerificationWorkspace().run(async owner => {
        const write = (name, content) => {
            const file = path.join(owner.directory, name);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, content);
        };
        write('src/page.css', 'body { color: red; }');
        write('src/page.html', '<h1>Shipped asset</h1>');
        write('src/nested/widget.css', '.widget { display: grid; }');
        for (const extension of ['ts', 'tsx', 'js', 'json']) write(`src/ignored.${extension}`, 'not a runtime asset');
        write('dist/app.js', 'compiled application');
        write('dist/page.css', 'old stylesheet');
        await owner.command([script], { timeoutMs: 5000 });
        expect(fs.readdirSync(path.join(owner.directory, 'dist')).sort()).toEqual(['app.js', 'nested', 'page.css', 'page.html']);
        expect(fs.readFileSync(path.join(owner.directory, 'dist/app.js'), 'utf8')).toBe('compiled application');
        for (const asset of ['page.css', 'page.html', 'nested/widget.css']) {
            expect(fs.readFileSync(path.join(owner.directory, 'dist', asset)))
                .toEqual(fs.readFileSync(path.join(owner.directory, 'src', asset)));
        }
    }), 25000); // 5s command + existing process/pipe cleanup + filesystem retries.

test('missing source assets fail the real copier command rather than producing a successful empty build', () =>
    new VerificationWorkspace().run(async owner => {
        await expect(owner.command([script], { timeoutMs: 5000 })).rejects.toThrow('ENOENT');
        expect(fs.existsSync(path.join(owner.directory, 'dist'))).toBe(false);
    }), 25000);
