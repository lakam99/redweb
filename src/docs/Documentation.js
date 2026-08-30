'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { projectFiles, TEMPLATES } = require('../cli/templates');

const normalize = text => text.replace(/\r\n/g, '\n');
const hash = text => createHash('sha256').update(text).digest('hex');
const fence = (text, language) => {
    const runs = text.match(/`+/g) || [];
    const delimiter = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
    return `${delimiter}${language}\n${text.trimEnd()}\n${delimiter}`;
};

/** Build-time content only. Loading Redweb's runtime does not load documentation. */
class Documentation {
    constructor(root, channel = 'unreleased') {
        this.root = root;
        this.manifest = JSON.parse(this.read('package.json'));
        if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(this.manifest.version)) {
            throw new Error('Documentation requires a valid package version.');
        }
        if (channel !== 'unreleased' && channel !== this.manifest.version) {
            throw new Error('Documentation channel must be unreleased or the exact package version.');
        }
        if (channel !== 'unreleased' && /^## Unreleased\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(this.read('CHANGELOG.md'))?.[1].trim()) {
            throw new Error('Move unreleased changes into the versioned changelog before building release documentation.');
        }
        if (channel !== 'unreleased' && !this.read('CHANGELOG.md').split('\n').includes(`## ${channel}`)) {
            throw new Error('Release documentation requires its versioned changelog section.');
        }
        this.channel = channel;
        this.basePath = `/docs/reference/${channel}`;
        this.topics = JSON.parse(this.read('docs/topics.json'));
        this.reference = JSON.parse(this.read('docs/reference.json'));
        this.sourceLinks = new Map(this.topics.map(topic => [topic.source, `${this.basePath}/${topic.id}.md`]));
        for (const example of this.reference.examples) {
            if (example.codeSource) this.sourceLinks.set(example.codeSource, `${this.basePath}/examples/${example.id}.md`);
        }
        for (const template of TEMPLATES) {
            for (const file of projectFiles(this.manifest.version, template, this.root)) {
                const source = file.path === 'test/app.test.cjs' ? 'app.test.cjs' : file.path.replace(/^src\//, '');
                this.sourceLinks.set(`recipes/${template}/${source}`, `${this.basePath}/recipes/${template}/files/${file.path}`);
            }
            this.sourceLinks.set(`recipes/${template}/README.md`, `${this.basePath}/recipes/${template}.md`);
        }
    }

    read(file) { return normalize(fs.readFileSync(path.join(this.root, file), 'utf8')); }

    links(markdown, source) {
        // Canonical Markdown links are rewritten outside code fences only.
        let delimiter = '';
        return markdown.split('\n').map(line => {
            const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
            if (marker) {
                if (!delimiter) delimiter = marker;
                else if (marker[0] === delimiter[0] && marker.length >= delimiter.length) delimiter = '';
                return line;
            }
            if (delimiter) return line;
            return line.replace(/\]\(([^\s)]+)\)/g, (match, target) => {
                if (/^(?:[a-z]+:|\/|#)/i.test(target)) return match;
                const [file, anchor = ''] = target.split('#');
                const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(source), file));
                const destination = this.sourceLinks.get(resolved);
                if (!destination) throw new Error(`Undocumented link target: ${source} -> ${target}`);
                return `](${destination}${anchor ? `#${anchor}` : ''})`;
            });
        }).join('\n');
    }

    notice() {
        return this.channel === 'unreleased'
            ? `> Unreleased development documentation. Package metadata is ${this.manifest.version}, but these features are not claimed to be published in that npm version. Use the matching packed artifact; do not install latest and assume compatibility.`
            : `> Documentation for Redweb ${this.channel}. Install that exact version when following these examples.`;
    }

    recipe(template) {
        const files = projectFiles(this.manifest.version, template, this.root).map(file => ({ ...file, content: normalize(file.content) }));
        const source = `recipes/${template}/README.md`;
        const explanation = this.links(this.read(source), source);
        const commands = this.channel === 'unreleased'
            ? [
                'These instructions require an absolute path to the matching tarball, produced by `npm pack` from this checkout. Replace `TARBALL` below with that path (quoted if it contains spaces). This is an explicit prerequisite, not an npm package name. Both commands must use the same tarball.',
                fence(`npx --yes --package TARBALL redweb init my-${template} --template ${template}\ncd my-${template}\nnpm install --save-exact TARBALL\nnpm test\nnpm run dev`, 'sh'),
            ].join('\n\n')
            : fence(`npx --yes redweb@${this.channel} init my-${template} --template ${template}\ncd my-${template}\nnpm install --save-exact redweb@${this.channel}\nnpm test\nnpm run dev`, 'sh');
        const markdown = [
            `# ${template[0].toUpperCase()}${template.slice(1)}: complete application`, this.notice(),
            explanation, '## Setup and acceptance', commands,
            this.read('recipes/shared/README.md').replace(/^# Your Redweb application\n/, ''),
            '## Exact generated files',
            'These files come from the initializer itself. The tests below run real listeners; they are not illustrative pseudocode. The generated manifest uses the package metadata version; the installation step above pins the matching artifact or release.',
            ...files.map(file => `### ${file.path}\n\n${fence(file.content, language(file.path))}`),
        ].join('\n\n') + '\n';
        return { id: `recipes/${template}`, title: `${template[0].toUpperCase()}${template.slice(1)} starter`, summary: explanation.split('\n').find(line => line && !line.startsWith('#')), source, markdown, files };
    }

    build() {
        const pages = this.topics.map(topic => ({
            ...topic,
            markdown: `${this.notice()}\n\n${this.links(this.read(topic.source), topic.source)}`,
        }));
        pages.push(...TEMPLATES.map(template => this.recipe(template)));
        const reference = this.reference;
        const recipeCode = entry => {
            const files = projectFiles(this.manifest.version, entry.template, this.root);
            const file = files.find(file => file.path === entry.file);
            if (!file) throw new Error(`Unknown documentation recipe file: ${entry.template}/${entry.file}`);
            return normalize(file.content);
        };
        const api = reference.api.map(section => ({ ...section, usage: section.recipe ? recipeCode(section.recipe) : section.usage }));
        const examples = reference.examples.map(example => ({ ...example, code: example.recipe ? recipeCode(example.recipe) : example.codeSource ? this.read(example.codeSource) : example.code }));
        for (const example of examples) {
            pages.push({ id: `examples/${example.id}`, title: example.title, summary: example.summary, source: 'docs/reference.json', markdown: [
                `# ${example.title}`, this.notice(), example.summary,
                example.recipe ? `Use the [complete ${example.recipe.template} recipe](${this.basePath}/recipes/${example.recipe.template}.md) for setup, files, and tests.` : 'This pattern demonstrates one API area. Application-specific names, credentials, assets, and policies may need to be supplied. Complete starter recipes include all required application files.',
                fence(example.code, example.language || 'js'),
                '## Notes and boundaries', example.notes.map(note => `- ${note}`).join('\n'),
            ].join('\n\n') + '\n' });
        }
        for (const section of api) {
            const article = section.article;
            pages.push({ id: `api/${section.id}`, title: section.name, summary: section.summary, source: 'docs/reference.json', markdown: [
                `# ${section.name}`, this.notice(), section.summary,
                '## Explain it like I\u2019m five', article.eli5,
                '## When should I use it?', article.useWhen,
                '## Follow the example',
                section.recipe ? `This source is part of the [complete ${section.recipe.template} recipe](${this.basePath}/recipes/${section.recipe.template}.md). Follow its setup and tests.` : 'This API pattern illustrates the named surface; it may require application-owned classes, credentials, or assets. Start from a complete recipe for a runnable application.',
                fence(section.usage, section.language || (section.type === 'Live HTML' ? 'tsx' : 'js')),
                article.walkthrough.map((step, index) => `${index + 1}. ${step}`).join('\n'),
                ...(section.options ? ['## Options', section.options.map(option => `- ${option}`).join('\n')] : []),
                '## Methods and members', section.methods.map(method => `### ${method.name}\n\n${method.detail}`).join('\n\n'),
                '## What should I watch for?', article.watchFor,
            ].join('\n\n') + '\n' });
        }
        const apiFiles = ['index.d.ts', 'client.d.ts', 'contract.d.ts', 'jsx-runtime.d.ts', 'jsx-dev-runtime.d.ts'];
        pages.push({ id: 'api-types', title: 'Complete public TypeScript declarations', summary: 'Exact shipped signatures, options, and public types; not standalone application snippets.', source: 'index.d.ts', markdown: [
            '# Public TypeScript API', this.notice(),
            ...apiFiles.map(file => `## ${file}\n\n${fence(this.read(file), 'ts')}`),
        ].join('\n\n') + '\n' });
        for (const page of pages) {
            page.url = `${this.basePath}/${page.id}.md`;
            page.sha256 = hash(page.markdown);
        }
        const llms = [
            '# Redweb',
            '> Server-rendered TypeScript/TSX sites with server-owned state/actions and routed WebSockets on Node.js.',
            this.notice(),
            'TSX is not React. State is assignment-driven. Shared memory is not durable storage. Socket routes select services; message types select handlers. Applications own identity, authorization, persistence, and delivery reconciliation.',
            '## Guides and complete recipes',
            ...pages.map(page => `- [${page.title}](${page.url}): ${page.summary}`),
        ].join('\n\n') + '\n';
        return { schemaVersion: 1, packageVersion: this.manifest.version, channel: this.channel, basePath: this.basePath, llms, pages, api, examples };
    }
}

function language(file) {
    const extension = path.extname(file);
    return ({ '.json': 'json', '.tsx': 'tsx', '.ts': 'ts', '.cjs': 'js', '.css': 'css', '.md': 'md' })[extension] || 'text';
}

module.exports = { Documentation, fence };
