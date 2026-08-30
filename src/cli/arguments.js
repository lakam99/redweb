'use strict';

const { TEMPLATES } = require('./templates');

const USAGE = [
    `Usage: redweb init [directory] [--template ${TEMPLATES.join('|')}] [--existing] [--dry-run] [--json]`,
    '       redweb doctor [directory] [--port number] [--json]',
    '       redweb --help | --version',
    '',
    '--existing creates only a missing tsconfig.json; no starter or package changes.',
    '--dry-run reports planned files without writing anything.',
    'doctor inspects configuration without executing application code or repairing files.',
].join('\n') + '\n';

function parseArguments(args) {
    const [command = '--help', ...rest] = args;
    if (['--help', '-h', '--version'].includes(command) && !rest.length) return { command };
    if (!['init', 'doctor'].includes(command)) throw new Error('Unknown command. Run redweb --help.');
    const result = { command, target: '.', existing: false, dryRun: false, json: false, port: null };
    let targetSeen = false;
    const seen = new Set();
    for (let i = 0; i < rest.length; i += 1) {
        const value = rest[i];
        if (!value.startsWith('-')) {
            if (targetSeen) throw new Error('Only one project directory is allowed.');
            result.target = value;
            targetSeen = true;
            continue;
        }
        if (seen.has(value)) throw new Error(`Duplicate option: ${value}`);
        seen.add(value);
        if (value === '--json') result.json = true;
        else if (value === '--existing' && command === 'init') result.existing = true;
        else if (value === '--dry-run' && command === 'init') result.dryRun = true;
        else if (value === '--template' && command === 'init') {
            const template = rest[++i];
            if (!TEMPLATES.includes(template)) throw new Error(`--template must be one of: ${TEMPLATES.join(', ')}.`);
            result.template = template;
        }
        else if (value === '--port' && command === 'doctor') {
            const port = rest[++i];
            if (!/^\d+$/.test(port) || Number(port) > 65535) throw new Error('--port must be an integer from 0 through 65535.');
            result.port = Number(port);
        } else throw new Error(`Unknown option for ${command}: ${value}`);
    }
    if (result.existing && result.template) throw new Error('--existing and --template cannot be combined.');
    return result;
}

module.exports = { parseArguments, USAGE };
