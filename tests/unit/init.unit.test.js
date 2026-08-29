'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const ProjectInitializer = require('../../src/cli/ProjectInitializer');
const { projectFiles } = require('../../src/cli/templates');

describe('ProjectInitializer', () => {
    let workspace;

    beforeEach(() => {
        workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-init-unit-'));
    });

    afterEach(() => {
        fs.rmSync(workspace, { recursive: true, force: true });
    });

    test('creates a complete typed TSX project on the real filesystem', () => {
        const files = projectFiles('1.2.3');
        const result = new ProjectInitializer('1.2.3').initialize(path.join(workspace, 'game'));

        expect(Object.isFrozen(files)).toBe(true);
        expect(files.every(Object.isFrozen)).toBe(true);
        expect(result.root).toBe(path.join(workspace, 'game'));
        expect(result.created).toEqual(['package.json', 'tsconfig.json', 'src/app.tsx', 'src/app.css']);
        expect(result.skipped).toEqual([]);
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.created)).toBe(true);
        expect(Object.isFrozen(result.skipped)).toBe(true);

        const manifest = JSON.parse(fs.readFileSync(path.join(result.root, 'package.json'), 'utf8'));
        const config = JSON.parse(fs.readFileSync(path.join(result.root, 'tsconfig.json'), 'utf8'));
        expect(manifest.dependencies.redweb).toBe('^1.2.3');
        expect(manifest.scripts.dev).toBe('npm run build && npm start');
        expect(config.extends).toBe('redweb/tsconfig.json');
        expect(fs.readFileSync(path.join(result.root, 'src', 'app.tsx'), 'utf8')).toContain("from 'redweb'");
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
        expect(result.skipped).toEqual(['package.json', 'tsconfig.json', 'src/app.tsx', 'src/app.css']);
        expect(fs.readFileSync(app, 'utf8')).toBe('user-owned source');
    });
});
