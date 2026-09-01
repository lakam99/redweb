'use strict';

const path = require('path');
const ProjectInitializer = require('./ProjectInitializer');
const { ProjectDoctor } = require('./ProjectDoctor');
const { ProjectAddition } = require('./ProjectAddition');
const formatCommand = require('./formatCommand');
const { parseArguments, USAGE } = require('./arguments');

async function run(args, cwd, version) {
    try {
        const options = parseArguments(args);
        if (options.command === '--version') return { exitCode: 0, stdout: `${version}\n`, stderr: '' };
        if (options.command === '--help' || options.command === '-h') return { exitCode: 0, stdout: USAGE, stderr: '' };
        const root = path.resolve(cwd, options.target);
        if (options.command === 'doctor') {
            const report = await new ProjectDoctor(version).inspect(root, options.port);
            const output = options.json ? JSON.stringify(report) : [
                `Redweb doctor: ${report.ok ? 'passed selected checks' : 'issues found'}`,
                ...report.issues.map(value => `${value.severity} ${value.code}${value.file ? ` (${value.file}${value.line ? `:${value.line}:${value.column}` : ''})` : ''}: ${value.message}\n  ${value.suggestion}`),
            ].join('\n');
            return { exitCode: report.ok ? 0 : 1, stdout: `${output}\n`, stderr: '' };
        }
        if (options.command === 'add') {
            const result = new ProjectAddition().add(root, options);
            const report = { schemaVersion: 1, operation: 'add', dryRun: options.dryRun, ...result };
            const output = options.json ? JSON.stringify(report) : [
                `${options.dryRun ? 'Planned addition' : 'Files created'} in ${result.root}`,
                `Files: ${result.planned.join(', ')}`,
                `Registration pending: ${result.registration.instruction}`,
                `Import (adjust relative path from your entry point): ${result.registration.importFromProjectRoot}`,
                `Build: ${formatCommand(result.verification.build)}`,
                `Test: ${formatCommand(result.verification.test)}`,
                result.verification.note,
            ].join('\n');
            return { exitCode: 0, stdout: `${output}\n`, stderr: '' };
        }
        const result = new ProjectInitializer(version).initialize(root, options);
        const report = { schemaVersion: 1, operation: 'init', dryRun: options.dryRun, ...result };
        const output = options.json ? JSON.stringify(report) : [
            `${options.dryRun ? 'Planned initialization' : 'Initialization complete'} in ${result.root}`,
            `Created: ${result.created.join(', ')}`,
            `Kept existing: ${result.skipped.join(', ')}`,
            `Planned: ${result.planned.join(', ')}`,
            'Existing files were not validated or changed. Run redweb doctor to check configuration.',
            options.existing ? 'No application or package files were generated.' : 'Next (published releases): npm install && npm run dev. Unreleased builds: install the matching Redweb tarball first (see README.md), then npm run dev.',
        ].join('\n');
        return { exitCode: 0, stdout: `${output}\n`, stderr: '' };
    } catch (error) {
        const output = args.includes('--json')
            ? JSON.stringify({ schemaVersion: 1, ok: false, error: { code: 'CLI_FAILED', message: error.message } })
            : `${error.message}\nRun redweb --help for usage.`;
        return { exitCode: 1, stdout: '', stderr: `${output}\n` };
    }
}

module.exports = { run };
