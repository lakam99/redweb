'use strict';

const fs = require('fs');
const path = require('path');
const { devDependencies, dependencies } = require('../../package.json');

const recipes = path.resolve(__dirname, '../../recipes');
const read = relative => fs.readFileSync(path.join(recipes, relative), 'utf8');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const TEMPLATES = Object.freeze(['realtime', 'chat', 'site', 'socket']);

function projectFiles(version, template = 'realtime') {
    if (!TEMPLATES.includes(template)) throw new Error('Unknown starter template.');
    const manifest = {
        name: 'redweb-app', private: true, version: '0.0.0',
        scripts: {
            build: 'tsc && node scripts/copy-assets.cjs',
            start: 'node dist/app.js',
            dev: 'nodemon',
            test: 'npm run build && node --test test/app.test.cjs',
        },
        dependencies: { redweb: `^${version}` },
        devDependencies: { typescript: devDependencies.typescript, nodemon: devDependencies.nodemon, ws: dependencies.ws },
        nodemonConfig: {
            watch: ['src', 'tsconfig.json'],
            ext: 'ts,tsx,css,html,json',
            exec: 'npm run build && npm start || exit 1',
            delay: 200,
        },
    };
    const files = [
        { path: 'package.json', content: json(manifest) },
        { path: 'tsconfig.json', content: json({
            extends: 'redweb/tsconfig.json',
            compilerOptions: { rootDir: 'src', outDir: 'dist' },
            include: ['src/**/*.ts', 'src/**/*.tsx'],
        }) },
        { path: 'src/app.tsx', content: read(`${template}/app.tsx`) },
        { path: 'src/app.css', content: read('shared/app.css') },
        { path: 'scripts/copy-assets.cjs', content: read('shared/copy-assets.cjs') },
        { path: 'test/network.cjs', content: read('shared/network.cjs') },
        { path: 'test/app.test.cjs', content: read(`${template}/app.test.cjs`) },
        { path: 'README.md', content: `${read('shared/README.md')}\n${read(`${template}/README.md`)}` },
        { path: '.gitignore', content: 'node_modules/\ndist/\n.env\n' },
    ];
    if (template === 'chat') {
        // The canonical component example is also the starter: one implementation to maintain.
        const examples = path.resolve(__dirname, '../../examples/live-html');
        for (const name of ['chatroom.tsx', 'chatroom.css']) {
            files.push({ path: `src/${name}`, content: fs.readFileSync(path.join(examples, name), 'utf8') });
        }
    }
    return Object.freeze(files.map(Object.freeze));
}

module.exports = { projectFiles, TEMPLATES };
