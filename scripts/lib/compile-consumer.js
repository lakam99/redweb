'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { spawnSync } = require('child_process');

/** Actual compiler and nominated package; source is unavailable before runtime tests. */
function compileConsumer(packageRoot, target, source, { experimentalDecorators, dependencies = [] }) {
    fs.mkdirSync(path.join(target, 'node_modules'), { recursive: true });
    fs.symlinkSync(packageRoot, path.join(target, 'node_modules/redweb'), 'junction');
    for (const name of dependencies) fs.symlinkSync(path.dirname(require.resolve(`${name}/package.json`)), path.join(target, 'node_modules', name), 'junction');
    const filename = `consumer${path.extname(source)}`;
    fs.copyFileSync(source, path.join(target, filename));
    fs.writeFileSync(path.join(target, 'tsconfig.json'), JSON.stringify({
        extends: 'redweb/tsconfig.json',
        compilerOptions: { experimentalDecorators, esModuleInterop: true, outDir: 'dist' },
        files: [filename],
    }));
    const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', target], { encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.equal(result.status, 0, result.stdout || result.stderr);
    fs.unlinkSync(path.join(target, filename));
    return path.join(target, 'dist/consumer.js');
}

module.exports = { compileConsumer };
