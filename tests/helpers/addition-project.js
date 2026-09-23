'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');

module.exports = function configure(workspace, type = 'commonjs', legacy = false) {
    fs.mkdirSync(path.join(workspace, 'node_modules'));
    for (const name of ['redweb', 'typescript', 'zod', 'ws']) {
        fs.symlinkSync(name === 'redweb' ? root : path.dirname(require.resolve(`${name}/package.json`)), path.join(workspace, 'node_modules', name), 'junction');
    }
    fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ type, dependencies: { redweb: '*', zod: '*' }, devDependencies: { ws: '*', typescript: '*' } }));
    fs.writeFileSync(path.join(workspace, 'tsconfig.json'), JSON.stringify({ extends: 'redweb/tsconfig.json', compilerOptions: {
        rootDir: 'source', outDir: 'build', experimentalDecorators: legacy,
    }, include: ['source/**/*.ts', 'source/**/*.tsx'] }));
    fs.mkdirSync(path.join(workspace, 'source'));
    fs.writeFileSync(path.join(workspace, 'source', 'app.ts'), 'throw new Error("The existing app must never be imported by addition tests"); export {};');
};
