'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { FilePlan, assertSafePath } = require('../../src/cli/FilePlan');

describe('shared scaffold file-plan writer on the real filesystem', () => {
    let workspace, root;
    beforeEach(() => { workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-file-plan-')); root = path.join(workspace, 'app'); });
    afterEach(() => fs.rmSync(workspace, { recursive: true, force: true }));
    const file = (name, content = 'generated') => ({ path: name, content });

    test('plans without side effects and freezes reports; skips or rejects existing files by policy', () => {
        const plan = new FilePlan(root, [file('src/new.ts')]);
        const dry = plan.write({ dryRun: true });
        expect(dry.planned).toEqual(['src/new.ts']);
        expect(dry.created).toEqual([]);
        expect(fs.existsSync(root)).toBe(false);
        expect(plan.write().created).toEqual(['src/new.ts']);
        expect(plan.write().skipped).toEqual(['src/new.ts']);
        expect(() => plan.write({ existing: 'reject' })).toThrow('Refusing to overwrite');
        expect(() => plan.write({ existing: 'overwrite' })).toThrow('Unknown existing-file policy');
        for (const value of [dry, dry.created, dry.skipped, dry.planned]) expect(Object.isFrozen(value)).toBe(true);
    });
    test('rejects escaping/root destinations and duplicate paths before any writes', () => {
        for (const name of ['..', '../outside.ts', '.', path.join(workspace, 'outside.ts')]) {
            expect(() => new FilePlan(root, [file('safe.ts'), file(name)]).write()).toThrow('inside the project');
        }
        for (const names of [['Foo.ts', 'foo.ts'], ['same.ts', 'same.ts'], ['Src/a.ts', 'src/b.ts'], ['src', 'src/new.ts'], ['src/new.ts', 'src']]) {
            expect(() => new FilePlan(root, names.map(name => file(name))).write()).toThrow('Conflicting planned destination');
        }
        expect(fs.existsSync(root)).toBe(false);
        expect(() => assertSafePath(workspace, root)).toThrow('inside the project');
        if (process.platform === 'win32') expect(() => assertSafePath('Z:\\outside.ts', root)).toThrow('inside the project');
    });
    test('rejects device names, alternate streams and path aliases portably', () => {
        for (const name of ['aux.ts', 'CON/file.ts', 'com¹/file.ts', 'lpt9.txt', 'file:stream', 'src./a.ts', 'src /a.ts', 'what?.ts', 'nul', 'x'.repeat(256), 'bad\u0001.ts']) {
            expect(() => new FilePlan(root, [file(name)]).write()).toThrow('Nonportable destination segment');
        }
        expect(fs.existsSync(root)).toBe(false);
        expect(() => new FilePlan(path.join(workspace, 'root.'), [file('new.ts')]).write()).toThrow('Nonportable destination segment');
    });
    test('rejects case aliases, directories in file positions and files in directory positions', () => {
        fs.mkdirSync(path.join(root, 'Src'), { recursive: true });
        expect(() => new FilePlan(root, [file('src/new.ts')]).write()).toThrow('Case-colliding');
        expect(() => new FilePlan(root, [file('Src')]).write()).toThrow('Expected a file');
        fs.writeFileSync(path.join(root, 'blocked'), 'existing file');
        expect(() => new FilePlan(root, [file('blocked/new.ts')]).write()).toThrow('Expected a directory');
    });
    test('refuses symlink ancestors above the chosen project root', () => {
        fs.mkdirSync(path.join(workspace, 'real'));
        const link = path.join(workspace, 'linked');
        fs.symlinkSync(path.join(workspace, 'real'), link, 'junction');
        expect(() => new FilePlan(path.join(link, 'app'), [file('src/new.ts')]).write()).toThrow('symbolic link');
        expect(fs.readdirSync(path.join(workspace, 'real'))).toEqual([]);
    });
    test('exclusive creation preserves a raced file and reports earlier completed writes', () => {
        const raced = file('raced.ts');
        Object.defineProperty(raced, 'content', { get() {
            fs.writeFileSync(path.join(root, 'raced.ts'), 'created by another writer');
            return 'must not overwrite';
        } });
        expect(() => new FilePlan(root, [file('first.ts'), raced]).write()).toThrow('Completed before failure: first.ts. Attempted: raced.ts');
        expect(fs.readFileSync(path.join(root, 'raced.ts'), 'utf8')).toBe('created by another writer');
        const second = file('second.ts');
        Object.defineProperty(second, 'content', { get() { throw new Error('failed template content'); } });
        expect(() => new FilePlan(root, [second]).write()).toThrow('Completed before failure: none. Attempted: second.ts');
    });
});
