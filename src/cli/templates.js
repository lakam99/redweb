'use strict';

const fs = require('fs');
const path = require('path');

const json = value => `${JSON.stringify(value, null, 2)}\n`;
const TEMPLATES = Object.freeze(['realtime', 'chat', 'site', 'socket', 'dashboard', 'http-ws']);
const CAPABILITIES = Object.freeze(['auth', 'multiplayer']);

function projectFiles(version, template = 'realtime', root = path.resolve(__dirname, '../..'), options = {}) {
    if (template !== null && !TEMPLATES.includes(template)) throw new Error('Unknown starter template.');
    if (options.with !== undefined && !Array.isArray(options.with)) throw new TypeError('Initializer capabilities must be an array.');
    const capabilities = new Set(options.with || []);
    if ([...capabilities].some(capability => !CAPABILITIES.includes(capability))) throw new Error('Unknown initializer capability.');
    const selected = template ?? 'foundation';
    const authenticated = template === 'dashboard' || capabilities.has('auth');
    const multiplayer = capabilities.has('multiplayer');
    const { devDependencies, dependencies, overrides } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const read = relative => fs.readFileSync(path.join(root, 'recipes', relative), 'utf8');
    const manifest = {
        name: 'redweb-app', private: true, version: '0.0.0',
        scripts: {
            build: 'tsc && node scripts/copy-assets.cjs',
            start: 'node dist/app.js',
            dev: 'nodemon',
            ...(!options.bare ? {
                test: 'npm run build && node --test test/app.test.cjs test/lifecycle.test.cjs',
                'test:coverage': 'npm run build && c8 --all --src=dist --include=dist/** --reporter=text --reporter=json node --test test/app.test.cjs test/lifecycle.test.cjs',
            } : {}),
        },
        dependencies: {
            redweb: `^${version}`,
            ...(['chat', 'socket', 'dashboard'].includes(template) || authenticated || multiplayer ? { zod: devDependencies.zod } : {}),
            ...(authenticated ? { express: dependencies.express } : {}),
            ...(multiplayer ? { 'redweb-client': dependencies['redweb-client'] } : {}),
        },
        overrides,
        devDependencies: {
            typescript: devDependencies.typescript, nodemon: devDependencies.nodemon, ws: dependencies.ws,
            ...(!options.bare ? { c8: devDependencies.c8 } : {}),
            ...(authenticated ? {
                '@types/node': devDependencies['redweb-dashboard-types'].replace('npm:@types/node@', ''),
                '@types/express': dependencies['@types/express'],
            } : {}),
        },
        nodemonConfig: {
            env: { REDWEB_DEV_REFRESH: '1' },
            watch: ['src', 'tsconfig.json'],
            ext: 'ts,tsx,css,html,json',
            exec: 'npm run build && npm start || exit 1',
            delay: 200,
        },
    };
    if (authenticated) manifest.engines = { node: '>=22.13.0' };
    if (template === 'dashboard') {
        manifest.scripts['add-user'] = 'npm run build && node dist/admin.js';
        if (!options.bare) manifest.scripts['test:coverage'] += ' test/rate-window.test.cjs';
    }
    const files = [
        { path: 'package.json', content: json(manifest) },
        { path: 'tsconfig.json', content: json({
            extends: 'redweb/tsconfig.json',
            compilerOptions: { rootDir: 'src', outDir: 'dist', sourceMap: true },
            include: ['src/**/*.ts', 'src/**/*.tsx'],
        }) },
        { path: 'src/app.tsx', content: read(`${selected}/app.tsx`) },
        { path: 'src/app.css', content: read(`${selected === 'dashboard' ? selected : 'shared'}/app.css`) },
        { path: 'scripts/copy-assets.cjs', content: read('shared/copy-assets.cjs') },
        ...(!options.bare ? [
            { path: 'test/network.cjs', content: read('shared/network.cjs') },
            { path: 'test/app.test.cjs', content: read(`${selected}/app.test.cjs`) },
            { path: 'test/lifecycle.test.cjs', content: read('shared/lifecycle.test.cjs') },
        ] : []),
        { path: 'README.md', content: `${read('shared/README.md')}\n${read(`${selected}/README.md`)}` },
        { path: '.gitignore', content: 'node_modules/\ndist/\ncoverage/\n.env\ndata/\n*.sqlite\n*.sqlite-wal\n*.sqlite-shm\n' },
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
        if (!options.bare) files.push({ path: 'test/rate-window.test.cjs', content: read('dashboard/rate-window.test.cjs') });
        for (const name of ['store.ts', 'auth.ts', 'cards.tsx', 'admin.ts']) {
            files.push({ path: `src/${name}`, content: read(`dashboard/${name}`) });
        }
    }
    return Object.freeze(files.map(Object.freeze));
}

module.exports = { projectFiles, CAPABILITIES, TEMPLATES };
