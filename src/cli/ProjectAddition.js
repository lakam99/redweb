'use strict';

const fs = require('fs');
const path = require('path');
const AdditionLayout = require('./AdditionLayout');
const { FilePlan } = require('./FilePlan');
const { resolveDependency } = require('./ProjectConfig');

const KINDS = Object.freeze(['page', 'component', 'socket-route']);
const relative = (root, file) => path.relative(root, file).replaceAll('\\', '/');
const fill = (template, values) => template.replace(/__([A-Z]+)__/g, (_, key) => values[key]);

class ProjectAddition {
    add(target, { kind, name, dryRun = false, testDir = 'test', ...layoutOptions }) {
        if (!KINDS.includes(kind)) throw new Error(`Addition kind must be ${KINDS.join(', ')}.`);
        if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
            throw new Error('Use a lowercase kebab-case name, starting with a letter (maximum 64 characters).');
        }
        const root = path.resolve(target);
        const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        for (const dependency of ['redweb', 'ws', ...(kind === 'socket-route' ? ['zod'] : [])]) {
            const runtime = dependency !== 'ws';
            if (!(manifest.dependencies?.[dependency] || (!runtime && manifest.devDependencies?.[dependency])) || !resolveDependency(root, dependency)) {
                throw new Error(`${dependency} must be explicitly declared and installed. Run npm install ${runtime ? '' : '--save-dev '}${dependency}.`);
            }
        }
        const layout = new AdditionLayout(root, layoutOptions);
        if (kind !== 'socket-route' && (layout.config.options.jsxImportSource !== 'redweb' ||
            ![layout.ts.JsxEmit.ReactJSX, layout.ts.JsxEmit.ReactJSXDev].includes(layout.config.options.jsx))) {
            throw new Error('Use Redweb JSX settings: extend redweb/tsconfig.json.');
        }
        const className = name.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('') +
            { page: 'Page', component: 'Component', 'socket-route': 'Route' }[kind];
        const directory = { page: 'pages', component: 'components', 'socket-route': 'socket-routes' }[kind];
        const source = relative(root, path.join(layout.sourceDir, directory, `${name}.${kind === 'socket-route' ? 'ts' : 'tsx'}`));
        const read = file => fs.readFileSync(path.resolve(__dirname, '../../recipes/add', file), 'utf8');
        const values = { NAME: name, CLASS: className, TITLE: name.split('-').join(' '), KIND: kind,
            DECORATOR: kind, DECORATION: kind === 'page' ? `@page('/${name}')` : '@component()' };
        const content = fill(read(kind === 'socket-route' ? 'socket-route.ts' : 'live.tsx'), values);
        const testFile = relative(root, path.resolve(root, testDir, `${name}.${kind}.test.cjs`));
        if (layout.includes(testFile)) throw new Error('The generated CJS test would enter TypeScript compilation. Choose --test-dir outside the configured inputs or explicitly exclude that test directory.');
        const output = layout.outputFor(source, content);
        const files = [
            { path: source, content },
            { path: testFile, content: fill(read('artifact.test.cjs'), { ...values,
                IMPORT: JSON.stringify(relative(path.dirname(path.resolve(root, testFile)), path.resolve(root, output))) }) },
        ];
        const result = new FilePlan(root, files).write({ dryRun, existing: 'reject' });
        return { ...result, kind, name, source, output, test: testFile,
            registration: { status: 'pending', export: className,
                importFromProjectRoot: `import { ${className} } from ${JSON.stringify('./' + source.replace(/\.tsx?$/, '.js'))};`,
                instruction: kind === 'component' ? `Import ${className} from ${source}, create a page field such as widget = new ${className}(), and render {this.widget}.`
                    : kind === 'page' ? `Import ${className} from ${source} and add it to your start([...]) page list.`
                        : `Import ${className} from ${source} and add it to your SocketServer routes list.` },
            verification: { build: ['npx', 'tsc', '-p', layout.configFile], test: ['node', '--test', testFile],
                note: 'Run the build, then the test from the project root. Existing package scripts and registrations are unchanged.' } };
    }
}

module.exports = { ProjectAddition, KINDS };
