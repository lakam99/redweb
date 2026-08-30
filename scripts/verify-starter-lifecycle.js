'use strict';

const path = require('node:path');
const { VerificationWorkspace } = require('./lib/VerificationWorkspace');
const { verifyStarter } = require('./lib/verify-starter');

async function main() {
    const root = path.resolve(__dirname, '..');
    await new VerificationWorkspace().run(async execution => {
        // All templates copy this exact helper and test; verifyStarter also checks
        // the generated commands and then removes src/ from the deployed layout.
        await verifyStarter(root, execution, 'realtime');
        console.log(await execution.command([
            require.resolve('c8/bin/c8.js'), '--all', '--src=dist', '--include=dist/run-app.js',
            '--reporter=text', '--reporter=json', `--reports-dir=${path.join(root, 'coverage/starter-lifecycle')}`,
            '--check-coverage', '--lines=100', '--branches=100', '--functions=100', '--statements=100',
            process.execPath, '--test', 'test/run-app.test.cjs',
        ], { cwd: path.join(execution.directory, 'realtime') }));
    });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
