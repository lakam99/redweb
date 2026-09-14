'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const ProjectInitializer = require('../../src/cli/ProjectInitializer');
const { projectFiles, TEMPLATES } = require('../../src/cli/templates');

describe('ProjectInitializer', () => {
    let workspace;

    beforeEach(() => {
        workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-init-unit-'));
    });

    afterEach(() => {
        fs.rmSync(workspace, { recursive: true, force: true });
    });

    test('creates a complete typed TSX project on the real filesystem', () => {
        const files = projectFiles('1.2.3', null);
        const result = new ProjectInitializer('1.2.3').initialize(path.join(workspace, 'game'));

        expect(Object.isFrozen(files)).toBe(true);
        expect(files.every(Object.isFrozen)).toBe(true);
        expect(result.root).toBe(path.join(workspace, 'game'));
        expect(result.created).toEqual(files.map(file => file.path));
        expect(result.skipped).toEqual([]);
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.created)).toBe(true);
        expect(Object.isFrozen(result.skipped)).toBe(true);

        const manifest = JSON.parse(fs.readFileSync(path.join(result.root, 'package.json'), 'utf8'));
        const config = JSON.parse(fs.readFileSync(path.join(result.root, 'tsconfig.json'), 'utf8'));
        expect(manifest.dependencies.redweb).toBe('^1.2.3');
        expect(manifest.scripts.dev).toBe('nodemon');
        expect(manifest.nodemonConfig.watch).toEqual(['src', 'tsconfig.json']);
        expect(config.extends).toBe('redweb/tsconfig.json');
        expect(fs.readFileSync(path.join(result.root, 'src', 'app.tsx'), 'utf8')).toContain('Redweb is ready.');
        expect(fs.readFileSync(path.join(result.root, 'src', 'app.css'), 'utf8')).toContain('.home');
    });

    test('is idempotent and never overwrites existing files', () => {
        const initializer = new ProjectInitializer('1.2.3');
        const target = path.join(workspace, 'existing');
        initializer.initialize(target);
        const app = path.join(target, 'src', 'app.tsx');
        fs.writeFileSync(app, 'user-owned source', 'utf8');

        const result = initializer.initialize(target);

        expect(result.created).toEqual([]);
        expect(result.skipped).toEqual(projectFiles('1.2.3', null).map(file => file.path));
        expect(fs.readFileSync(app, 'utf8')).toBe('user-owned source');
    });

    test('composes neutral capabilities and lets bare omit tests without choosing an example', () => {
        const result = new ProjectInitializer('1.2.3').initialize(path.join(workspace, 'capable'), {
            with: ['auth', 'multiplayer'], bare: true,
        });
        const manifest = JSON.parse(fs.readFileSync(path.join(result.root, 'package.json'), 'utf8'));
        expect(manifest.dependencies).toEqual(expect.objectContaining({ redweb: '^1.2.3', express: expect.any(String), zod: expect.any(String), 'redweb-client': expect.any(String) }));
        expect(manifest.devDependencies).toEqual(expect.objectContaining({ '@types/node': expect.any(String), '@types/express': expect.any(String) }));
        expect(manifest.devDependencies.c8).toBeUndefined();
        expect(manifest.scripts.test).toBeUndefined();
        expect(result.planned.some(file => file.startsWith('test/'))).toBe(false);
        expect(fs.readFileSync(path.join(result.root, 'src/app.tsx'), 'utf8')).toContain('Redweb is ready.');
        expect(() => projectFiles('1.2.3', null, undefined, { with: ['unknown'] })).toThrow('Unknown initializer capability');
        expect(() => projectFiles('1.2.3', null, undefined, { with: 'auth' })).toThrow('Initializer capabilities must be an array');

        const authOnly = JSON.parse(projectFiles('1.2.3', null, undefined, { with: ['auth'] })[0].content);
        const multiplayerOnly = JSON.parse(projectFiles('1.2.3', null, undefined, { with: ['multiplayer'] })[0].content);
        expect(authOnly.dependencies['redweb-client']).toBeUndefined();
        expect(multiplayerOnly.dependencies.express).toBeUndefined();

        const bareDashboard = projectFiles('1.2.3', 'dashboard', undefined, { bare: true });
        expect(bareDashboard.some(file => file.path === 'test/rate-window.test.cjs')).toBe(false);
        expect(JSON.parse(bareDashboard[0].content).scripts['add-user']).toBeDefined();
    });

    test('selects complete recipes and rejects unsupported templates before writing', () => {
        expect(projectFiles('1.2.3').some(file => file.path === 'src/app.tsx')).toBe(true);
        for (const template of TEMPLATES) {
            const result = new ProjectInitializer('1.2.3').initialize(path.join(workspace, template), { template });
            expect(result.created).toContain('test/app.test.cjs');
            expect(result.created).toContain('README.md');
            expect(fs.readFileSync(path.join(result.root, 'README.md'), 'utf8')).toContain('npm test');
            const manifest = JSON.parse(fs.readFileSync(path.join(result.root, 'package.json'), 'utf8'));
            expect(manifest.overrides).toEqual({ express: { qs: '6.16.0' } });
            expect(manifest.overrides).toEqual(require('../../package.json').overrides);
            expect(manifest.devDependencies.c8).toBeDefined();
            expect(manifest.scripts['test:coverage']).toContain('c8 --all --src=dist --include=dist/**');
            expect(JSON.parse(fs.readFileSync(path.join(result.root, 'tsconfig.json'), 'utf8')).compilerOptions.sourceMap).toBe(true);
            expect(fs.readFileSync(path.join(result.root, '.gitignore'), 'utf8')).toContain('coverage/');
        }
        expect(fs.readFileSync(path.join(workspace, 'chat/src/chatroom.tsx'), 'utf8')).toBe(fs.readFileSync(path.resolve(__dirname, '../../examples/live-html/chatroom.tsx'), 'utf8'));
        expect(JSON.parse(fs.readFileSync(path.join(workspace, 'chat/package.json'), 'utf8')).dependencies.zod).toBeDefined();
        expect(() => projectFiles('1.2.3', '../outside')).toThrow('Unknown starter');
    });
});
