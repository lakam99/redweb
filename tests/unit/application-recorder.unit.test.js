'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const preload = path.resolve(__dirname, '../../scripts/lib/record-application-coverage.cjs');

test('native coverage recorder callback has direct authored branch/function coverage', () => new VerificationWorkspace().run(async owner => {
    const previous = process.listeners('exit');
    const original = globalThis.__redwebApplicationCoverage__;
    const directory = process.env.REDWEB_APPLICATION_COVERAGE_DIRECTORY;
    let added = [];
    try {
        jest.isolateModules(() => require(preload));
        added = process.listeners('exit').filter(listener => !previous.includes(listener));
        expect(added).toHaveLength(1);
        delete globalThis.__redwebApplicationCoverage__;
        added[0]();
        expect(fs.readdirSync(owner.directory)).toEqual([]);
        process.env.REDWEB_APPLICATION_COVERAGE_DIRECTORY = owner.directory;
        globalThis.__redwebApplicationCoverage__ = { counter: 3 };
        added[0]();
        const files = fs.readdirSync(owner.directory);
        expect(files).toHaveLength(1);
        expect(JSON.parse(fs.readFileSync(path.join(owner.directory, files[0]), 'utf8'))).toEqual({ counter: 3 });
    } finally {
        added.forEach(listener => process.off('exit', listener));
        if (original === undefined) delete globalThis.__redwebApplicationCoverage__;
        else globalThis.__redwebApplicationCoverage__ = original;
        if (directory === undefined) delete process.env.REDWEB_APPLICATION_COVERAGE_DIRECTORY;
        else process.env.REDWEB_APPLICATION_COVERAGE_DIRECTORY = directory;
    }
}));

// Isolated recorder units use actual Node exits and files, not replacement APIs.
test('native coverage recorder does not invent a report without instrumented data', () => new VerificationWorkspace().run(async owner => {
    await owner.command(['--require', preload, '-e', 'process.exitCode = 0'], { timeoutMs: 5000,
        environment: { REDWEB_APPLICATION_COVERAGE_DIRECTORY: owner.directory } });
    expect(fs.readdirSync(owner.directory)).toEqual([]);
}), 25000);

test('native coverage recorder preserves exact data and unique child identities at exit', () => new VerificationWorkspace().run(async owner => {
    const expected = { 'app.ts': { path: 'app.ts', s: { 0: 3 }, f: { 0: 1 }, b: { 0: [1, 2] } } };
    const program = `globalThis.__redwebApplicationCoverage__ = ${JSON.stringify(expected)}; console.log(process.pid);`;
    const names = [];
    for (let index = 0; index < 2; index++) {
        const pid = (await owner.command(['--require', preload, '-e', program], { timeoutMs: 5000,
            environment: { REDWEB_APPLICATION_COVERAGE_DIRECTORY: owner.directory } })).trim();
        const current = fs.readdirSync(owner.directory).filter(name => !names.includes(name));
        expect(current).toHaveLength(1);
        expect(current[0]).toMatch(new RegExp(`^${pid}-[0-9a-f-]{36}\\.json$`));
        expect(JSON.parse(fs.readFileSync(path.join(owner.directory, current[0]), 'utf8'))).toEqual(expected);
        names.push(current[0]);
    }
    expect(new Set(names).size).toBe(2);
}), 35000);

test.each(['missing-directory', 'circular-data'])('native coverage recorder fails visibly for %s', mode => new VerificationWorkspace().run(async owner => {
    const program = 'globalThis.__redwebApplicationCoverage__ = {};' +
        (mode === 'circular-data' ? 'globalThis.__redwebApplicationCoverage__.self = globalThis.__redwebApplicationCoverage__;' : '');
    await expect(owner.command(['--require', preload, '-e', program], { timeoutMs: 5000,
        environment: { REDWEB_APPLICATION_COVERAGE_DIRECTORY: mode === 'missing-directory' ? path.join(owner.directory, 'absent') : owner.directory } }))
        .rejects.toThrow(mode === 'missing-directory' ? 'ENOENT' : 'circular');
    expect(fs.readdirSync(owner.directory)).toEqual([]);
}), 25000);
