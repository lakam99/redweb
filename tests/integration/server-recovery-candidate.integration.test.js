'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { evaluate } = require('../../scripts/lib/ServerRecoveryPolicy');
const { fingerprint } = require('../../scripts/lib/ServerRecoveryCandidate');
const { createCoverageMap } = require('istanbul-lib-coverage');
const { cleanupWorkers } = require('../helpers/recovery-worker-cleanup');
const { spawnManaged, stopProcessTree } = require('../../scripts/evaluation/process');
const { once } = require('node:events');
const { withTimeout } = require('../helpers/network');
const script = path.resolve(__dirname, '../../scripts/verify-server-recovery.js');
const environment = { NODE_OPTIONS: '', NODE_V8_COVERAGE: '' };

test('candidate uses two actual workers, exact 7400 replies, normal exits and preserved logs', () =>
    new VerificationWorkspace().run(async owner => {
        const directory = path.join(owner.directory, 'candidate');
        const coverage = path.join(owner.directory, 'coordinator-coverage');
        // A managed Jest child instruments the original coordinator, not the
        // measured workers. Collection is non-gating here; the combined parent
        // report retains its full threshold. No application/API is replaced.
        let primary;
        try { await owner.command([require.resolve('jest/bin/jest'), '--runInBand', '--runTestsByPath',
            path.resolve(__dirname, '../fixtures/server-recovery-owned.test.cjs'),
            '--testMatch=**/fixtures/server-recovery-owned.test.cjs', '--coverage',
            '--collectCoverageFrom=scripts/lib/ServerRecoveryCandidate.js',
            '--collectCoverageFrom=scripts/lib/ServerRecoveryPolicy.js',
            `--coverageDirectory=${coverage}`, '--coverageThreshold={}'], {
            cwd: path.resolve(__dirname, '../..'), timeoutMs: 90000,
            environment: { ...environment, TEST_CANDIDATE_EVIDENCE: directory },
        }); } catch (error) { primary = error; }
        try { await cleanupWorkers(directory); }
        catch (cleanup) {
            // Missing/incomplete registration is uncertainty, not proof of no
            // children. Preserve the workspace as well as the primary error.
            owner.cleanupFailure = new AggregateError([primary, cleanup].filter(Boolean), 'Recovery worker cleanup uncertain');
            throw owner.cleanupFailure;
        }
        if (primary) throw primary;
        const childCoverage = JSON.parse(fs.readFileSync(path.join(coverage, 'coverage-final.json'), 'utf8'));
        const merged = createCoverageMap(globalThis.__coverage__ || {});
        for (const [file, child] of Object.entries(childCoverage)) {
            const parent = globalThis.__coverage__?.[file];
            if (parent) for (const mapping of ['statementMap', 'branchMap', 'fnMap']) {
                expect(child[mapping]).toEqual(parent[mapping]);
            }
            if (parent) merged.merge({ [file]: child });
        }
        globalThis.__coverage__ = Object.fromEntries(merged.files().map(file =>
            [file, merged.fileCoverageFor(file).toJSON()]));
        const saved = JSON.parse(fs.readFileSync(path.join(directory, 'report.json'), 'utf8'));
        expect(saved.finalSourceHashes).toEqual(fingerprint());
        expect(saved.deliveryAndCleanupPassed).toBe(true);
        expect(evaluate(saved).exactReplies).toBe(7400);
        expect(saved.workerExits.every(worker => worker.exitCode === 0 && !worker.forcedCleanupNeeded)).toBe(true);
        expect(fs.readFileSync(path.join(directory, 'samples.ndjson'), 'utf8').trim().split('\n')).toHaveLength(7);
    }), 150000);

test('real CLI rejects overrides, flags, invalid arguments and existing evidence before acquiring workers', () =>
    new VerificationWorkspace().run(async owner => {
        for (const [args, overrides, message] of [
            [[], { REDWEB_RECOVERY_BATCH_SIZE: '1' }, 'does not accept REDWEB_RECOVERY_BATCH_SIZE'],
            [['--expose-gc', script], {}, 'does not accept Node flags'],
            [[script, 'relative'], {}, 'must be absolute'],
            [[script, owner.directory], {}, 'EEXIST'],
            [[script, owner.directory, 'extra'], {}, 'Usage:'],
        ]) {
            await expect(owner.command(args.length ? args : [script], {
                environment: { ...environment, ...overrides }, timeoutMs: 5000,
            }))
                .rejects.toThrow(message);
            expect(fs.readdirSync(owner.directory)).toEqual([]);
        }
    }), 90000);

test.each(['valid', 'malformed', 'missing', 'duplicate', 'pid-one'])(
    'outer ownership reaps stuck workers and rejects incomplete registration (%s)', mode =>
    new VerificationWorkspace().run(async owner => {
        const children = ['server', 'client'].map(() => spawnManaged(['-e', 'process.stdout.write("ready"); while (true) {}']));
        try {
            await withTimeout(Promise.all(children.map(child => once(child.stdout, 'data'))), 'registered worker readiness', 5000);
            const records = children.map((child, index) => ({ role: index ? 'client' : 'server', pid: child.pid }));
            if (mode === 'missing') records.pop();
            if (mode === 'duplicate') records[1].role = 'server';
            if (mode === 'pid-one') records.push({ role: 'server', pid: 1 });
            fs.writeFileSync(path.join(owner.directory, 'workers.ndjson'),
                records.map(record => JSON.stringify(record)).join('\n') + '\n' + (mode === 'malformed' ? 'invalid\n' : ''));
            if (mode !== 'valid') await expect(cleanupWorkers(owner.directory)).rejects.toThrow(AggregateError);
            else await cleanupWorkers(owner.directory);
            expect(() => process.kill(children[0].pid, 0)).toThrow();
            if (mode !== 'missing') expect(() => process.kill(children[1].pid, 0)).toThrow();
        } finally { await Promise.all(children.map(stopProcessTree)); }
    }), 30000);
