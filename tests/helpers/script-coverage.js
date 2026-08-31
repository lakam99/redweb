'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const ts = require('typescript');
const ApplicationCoverage = require('../../scripts/lib/ApplicationCoverage');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { verificationError } = require('../../scripts/lib/verificationError');

const root = path.resolve(__dirname, '../..');
const hash = value => createHash('sha256').update(value).digest('hex');
function fingerprint(directory, relative = '') {
    return Object.fromEntries(fs.readdirSync(path.join(directory, relative), { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
            const file = path.join(relative, entry.name);
            assert.ok(!entry.isSymbolicLink(), 'Generator fixtures must contain their actual inputs, not links');
            return entry.isDirectory() ? Object.entries(fingerprint(directory, file))
                : [[file, hash(fs.readFileSync(path.join(directory, file)))]];
        }));
}

/** Run identical real CLI cases on ordinary and original-source-instrumented scripts. */
async function verifyScript({ script, testFile, prepare, exercise }) {
    const filename = path.join(root, script);
    const original = fs.readFileSync(filename, 'utf8');
    const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS };
    const coverage = new ApplicationCoverage({ [filename]: original }, compilerOptions);
    const directory = path.join(root, 'coverage/tool-source', randomUUID());
    const reports = path.join(directory, 'processes');
    fs.mkdirSync(reports, { recursive: true });
    const preload = path.join(root, 'scripts/lib/record-application-coverage.cjs');
    const toolingFiles = [filename, testFile, __filename, preload,
        path.join(root, 'scripts/lib/ApplicationCoverage.js'), path.join(root, 'scripts/lib/VerificationWorkspace.js'),
        path.join(root, 'scripts/lib/verificationError.js'), path.join(root, 'scripts/lib/assertCoverageFile.js')];
    const tooling = () => Object.fromEntries(toolingFiles.map(file => [path.relative(root, file), hash(fs.readFileSync(file))]));
    const result = { script, passed: false, node: process.version, platform: process.platform,
        typescript: ts.version, compilerOptions, tooling: tooling(), commands: {},
        receivedProcessReports: 0, compiledSha256: hash(coverage.compiled[filename]) };
    let failure;
    try {
        for (const mode of ['plain', 'instrumented']) {
            result.phase = mode;
            result.commands[mode] = [];
            await new VerificationWorkspace().run(async owner => {
                await prepare(owner.directory);
                const target = path.join(owner.directory, script);
                assert.equal(fs.readFileSync(target, 'utf8'), original, 'Fixture must start with the actual unmodified script');
                const inputs = fingerprint(owner.directory);
                if (mode === 'plain') result.inputs = inputs;
                else assert.deepEqual(inputs, result.inputs, 'Both modes must start with identical fixture inputs');
                if (mode === 'instrumented') fs.writeFileSync(target, coverage.compiled[filename]);
                const command = async args => {
                    const entry = { args, passed: false };
                    result.commands[mode].push(entry);
                    const commandReports = path.join(reports, mode, String(result.commands[mode].length));
                    fs.mkdirSync(commandReports, { recursive: true });
                    try {
                        entry.stdout = await owner.command([target, ...args], { timeoutMs: 5000, environment: {
                            NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ${JSON.stringify(preload)}`,
                            REDWEB_APPLICATION_COVERAGE_DIRECTORY: commandReports,
                        } });
                        entry.passed = true;
                        return entry.stdout;
                    } catch (error) {
                        const failure = verificationError(error);
                        entry.error = failure.stack; throw failure;
                    }
                };
                await exercise(owner.directory, command);
            });
            for (const [index, command] of result.commands[mode].entries()) {
                const commandReports = path.join(reports, mode, String(index + 1));
                const files = fs.readdirSync(commandReports);
                assert.equal(files.length, mode === 'plain' ? 0 : 1, `${mode} command ${index + 1}: unexpected coverage report count`);
                if (mode === 'instrumented') {
                    const file = path.join(commandReports, files[0]);
                    const bytes = fs.readFileSync(file);
                    coverage.collect(JSON.parse(bytes));
                    command.coverageReport = { path: path.relative(directory, file), sha256: hash(bytes) };
                    result.receivedProcessReports++;
                }
            }
        }
        result.phase = 'coverage';
        assert.deepEqual(result.commands.instrumented.map(({ args, passed }) => ({ args, passed })),
            result.commands.plain.map(({ args, passed }) => ({ args, passed })), 'Both modes must execute the same CLI cases and outcomes');
        assert.ok(result.receivedProcessReports, 'Actual instrumented processes must report coverage');
        assert.deepEqual(tooling(), result.tooling, 'Original source and verification inputs must remain unchanged');
        coverage.assertComplete();
        result.passed = true;
    } catch (error) { failure = verificationError(error); result.error = failure.stack; }
    try { fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify({ ...result, ...coverage.report() }, null, 2), { flag: 'wx' }); }
    catch (error) { failure = failure ? new AggregateError([failure, error], failure.message, { cause: failure }) : error; }
    if (failure) throw failure;
    return result;
}

module.exports = { verifyScript };
