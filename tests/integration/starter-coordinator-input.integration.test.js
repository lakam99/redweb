'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const root = path.resolve(__dirname, '../..');

test.each(['measure-starter-coverage.js', 'verify-starter-source-coverage.js'])
('actual starter coordinator rejects input mutation after a successful build/test: %s', script =>
    new VerificationWorkspace().run(async owner => {
        const repository = path.join(owner.directory, 'repository');
        fs.mkdirSync(repository);
        for (const directory of ['src', 'recipes', 'scripts', 'bin', 'config', 'tests/helpers', 'docs', 'examples']) {
            fs.cpSync(path.join(root, directory), path.join(repository, directory), { recursive: true });
        }
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
            if (entry.isFile() && /\.(?:[cm]?js|json|ts)$/.test(entry.name)) fs.copyFileSync(path.join(root, entry.name), path.join(repository, entry.name));
        }
        fs.symlinkSync(path.join(root, 'node_modules'), path.join(repository, 'node_modules'), 'junction');
        const recipe = path.join(repository, 'recipes/realtime/app.test.cjs');
        // Deliberately faulty application fixture, not replacement compiler/fs APIs:
        // after compilation, change a source comment while the real tests still pass.
        fs.appendFileSync(recipe, "\nrequire('node:fs').appendFileSync(require('node:path').join(__dirname, '../src/app.tsx'), '\\n// modified by actual test\\n');\n");
        expect(fs.readFileSync(path.join(repository, 'scripts', script), 'utf8')).toBe(fs.readFileSync(path.join(root, 'scripts', script), 'utf8'));
        // No outer subprocess can kill the coordinator before its independently
        // bounded children settle. CLI entrypoints are exercised by the full gate.
        const { main } = require(path.join(repository, 'scripts', script));
        const previousOptions = process.env.NODE_OPTIONS;
        let failure;
        try {
            process.env.NODE_OPTIONS = `${previousOptions || ''} --test-reporter=tap`;
            failure = await main().catch(error => error);
        } finally {
            if (previousOptions === undefined) delete process.env.NODE_OPTIONS;
            else process.env.NODE_OPTIONS = previousOptions;
        }
        // Do not remove dependencies/evidence of an inner owner that could not
        // confirm its child cleanup, even if the assertions below subsequently fail.
        if (failure?.retainedWorkspace) owner.cleanupFailure = failure;
        expect(require('node:util').types.isNativeError(failure)).toBe(true);
        expect(failure.message).toContain('must retain identical application and test inputs');
        const authored = script.startsWith('verify');
        const output = path.join(repository, 'coverage', authored ? 'starter-source' : 'starters');
        const latest = JSON.parse(fs.readFileSync(path.join(output, 'latest.json'), 'utf8'));
        expect(latest.status).toBe('failed');
        const retained = path.join(output, latest.runId);
        const summary = JSON.parse(fs.readFileSync(path.join(retained, 'summary.json'), 'utf8'));
        expect(summary.status).toBe('failed');
        expect(summary.error).toContain('must retain identical application and test inputs');
        const raw = JSON.parse(fs.readFileSync(path.join(retained, 'realtime', authored ? 'v8-coverage.json' : 'coverage-final.json'), 'utf8'));
        const application = Object.keys(raw).find(file => file.endsWith(path.join('src', 'app.tsx')));
        expect(application).toBeTruthy();
        expect(fs.existsSync(path.dirname(path.dirname(application)))).toBe(false);
        const log = fs.readFileSync(path.join(retained, 'realtime', authored ? 'plain.txt' : 'test-output.txt'), 'utf8');
        // One realtime behavior test plus four shared application-entrypoint tests.
        expect(log).toContain('# pass 5');
        expect(log).toContain('# fail 0');
        if (authored) expect(fs.readdirSync(path.join(retained, 'realtime/process-reports')).length).toBeGreaterThan(0);
    }), 2400000); // Covers even all six 3×120s command paths plus cleanup; no outer kill.
