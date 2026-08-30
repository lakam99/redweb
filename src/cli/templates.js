'use strict';

const fs = require('fs');
const path = require('path');

const json = value => `${JSON.stringify(value, null, 2)}\n`;
const TEMPLATES = Object.freeze(['realtime', 'chat', 'site', 'socket', 'dashboard']);

function projectFiles(version, template = 'realtime', root = path.resolve(__dirname, '../..')) {
    if (!TEMPLATES.includes(template)) throw new Error('Unknown starter template.');
    const { devDependencies, dependencies } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const read = relative => fs.readFileSync(path.join(root, 'recipes', relative), 'utf8');
    const manifest = {
        name: 'redweb-app', private: true, version: '0.0.0',
        scripts: {
            build: 'tsc && node scripts/copy-assets.cjs',
            start: 'node dist/app.js',
            dev: 'nodemon',
            test: 'npm run build && node --test test/app.test.cjs',
        },
        dependencies: {
            redweb: `^${version}`,
            ...(['socket', 'dashboard'].includes(template) ? { zod: devDependencies.zod } : {}),
            ...(template === 'dashboard' ? { express: dependencies.express } : {}),
        },
        devDependencies: {
            typescript: devDependencies.typescript, nodemon: devDependencies.nodemon, ws: dependencies.ws,
            ...(template === 'dashboard' ? {
                '@types/node': devDependencies['redweb-dashboard-types'].replace('npm:@types/node@', ''),
                '@types/express': dependencies['@types/express'], c8: devDependencies.c8,
            } : {}),
        },
        nodemonConfig: {
            watch: ['src', 'tsconfig.json'],
            ext: 'ts,tsx,css,html,json',
            exec: 'npm run build && npm start || exit 1',
            delay: 200,
        },
    };
    if (template === 'dashboard') {
        manifest.engines = { node: '>=22.13.0' };
        manifest.scripts['add-user'] = 'npm run build && node dist/admin.js';
        manifest.scripts['test:coverage'] = 'npm run build && c8 --all --src=dist --include=dist/** --reporter=text --reporter=json node --test test/app.test.cjs';
    }
    const files = [
        { path: 'package.json', content: json(manifest) },
        { path: 'tsconfig.json', content: json({
            extends: 'redweb/tsconfig.json',
            compilerOptions: { rootDir: 'src', outDir: 'dist', ...(template === 'dashboard' ? { sourceMap: true } : {}) },
            include: ['src/**/*.ts', 'src/**/*.tsx'],
        }) },
        { path: 'src/app.tsx', content: read(`${template}/app.tsx`) },
        { path: 'src/app.css', content: read(`${template === 'dashboard' ? template : 'shared'}/app.css`) },
        { path: 'scripts/copy-assets.cjs', content: read('shared/copy-assets.cjs') },
        { path: 'test/network.cjs', content: read('shared/network.cjs') },
        { path: 'test/app.test.cjs', content: read(`${template}/app.test.cjs`) },
        { path: 'README.md', content: `${read('shared/README.md')}\n${read(`${template}/README.md`)}` },
        { path: '.gitignore', content: 'node_modules/\ndist/\n.env\ndata/\n*.sqlite\n*.sqlite-wal\n*.sqlite-shm\n' },
    ];
    if (template === 'chat') {
        // The canonical component example is also the starter: one implementation to maintain.
        const examples = path.join(root, 'examples/live-html');
        for (const name of ['chatroom.tsx', 'chatroom.css']) {
            files.push({ path: `src/${name}`, content: fs.readFileSync(path.join(examples, name), 'utf8') });
        }
    }
    if (template === 'socket') {
        for (const name of ['contract.ts', 'handlers.ts']) {
            files.push({ path: `src/${name}`, content: read(`socket/${name}`) });
        }
    }
    if (template === 'dashboard') {
        files.push({ path: '.npmrc', content: 'engine-strict=true\n' });
        for (const name of ['store.ts', 'auth.ts', 'cards.tsx', 'admin.ts']) {
            files.push({ path: `src/${name}`, content: read(`dashboard/${name}`) });
        }
    }
    return Object.freeze(files.map(Object.freeze));
}

module.exports = { projectFiles, TEMPLATES };
