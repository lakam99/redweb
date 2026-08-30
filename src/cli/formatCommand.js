'use strict';

/** Explicit argv remains authoritative; human output is quoted for the host shell. */
function formatCommand(args, platform = process.platform) {
    return platform === 'win32'
        ? '& ' + args.map(value => `'${value.replaceAll("'", "''")}'`).join(' ')
        : args.map(value => `'${value.replaceAll("'", "'\\''")}'`).join(' ');
}

module.exports = formatCommand;
