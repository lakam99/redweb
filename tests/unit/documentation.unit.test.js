'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');
const { Documentation, fence } = require('../../src/docs/Documentation');
const { projectFiles, TEMPLATES } = require('../../src/cli/templates');
const { copyDocumentationSource } = require('../helpers/documentation');

const root = path.resolve(__dirname, '../..');
const { version } = require('../../package.json');

describe('single-source documentation', () => {
    test('builds deterministic versioned content and exact initializer files', () => {
        const builder = new Documentation(root);
        const docs = builder.build();
        expect(builder.build()).toEqual(docs);
        expect(docs.channel).toBe('unreleased');
        expect(docs.packageVersion).toBe(version);
        expect(docs.pages).toHaveLength(require('../../docs/topics.json').length + TEMPLATES.length + 1 + docs.api.length + docs.examples.length);
        expect(new Set(docs.pages.map(page => page.id)).size).toBe(docs.pages.length);
        for (const page of docs.pages) {
            expect(docs.llms).toContain(`](${page.url})`);
            expect(page.markdown).toContain('Unreleased development documentation');
            expect(page.sha256).toBe(createHash('sha256').update(page.markdown).digest('hex'));
        }
        for (const template of TEMPLATES) {
            const recipe = docs.pages.find(page => page.id === `recipes/${template}`);
            const files = projectFiles(version, template).map(file => ({ ...file, content: file.content.replace(/\r\n/g, '\n') }));
            expect(recipe.files).toEqual(files);
            for (const file of files) expect(recipe.markdown).toContain(file.content.trimEnd());
            expect(recipe.markdown).toContain(`--template ${template}`);
            expect(recipe.markdown).toContain('npm install --save-exact TARBALL');
            expect(recipe.markdown).toContain('npm test');
            expect(recipe.markdown).toContain('No mocks');
        }
        const api = docs.pages.find(page => page.id === 'api-types').markdown;
        expect(api).toContain('interface LiveHtmlServerOptions');
        expect(api).toContain('SocketContract');
        const contract = docs.pages.find(page => page.id === 'socket-contracts').markdown;
        expect(contract).toContain('](/docs/reference/unreleased/recipes/socket.md)');
        expect(contract).toContain('](/docs/reference/unreleased/recipes/socket/files/src/contract.ts)');
        for (const section of docs.api) {
            const article = docs.pages.find(page => page.id === `api/${section.id}`);
            expect(article.markdown).toContain(section.usage.trimEnd());
            expect(article.markdown).toContain(section.article.eli5);
        }
    });

    test('resolves source-relative links without rewriting code examples', () => {
        const builder = new Documentation(root);
        expect(builder.links('[state](LIVE_HTML.md#automatic-reactive-tsx)', 'docs/CLI.md'))
            .toBe('[state](/docs/reference/unreleased/live-html.md#automatic-reactive-tsx)');
        expect(builder.links('[local](#here) [web](https://example.com) [root](/docs)', 'docs/CLI.md'))
            .toBe('[local](#here) [web](https://example.com) [root](/docs)');
        const code = '```md\n[x](missing.md)\n~~~\n``\n````\n~~~md\n[y](also-missing.md)\n~~~';
        expect(builder.links(code, 'docs/CLI.md')).toBe(code);
        expect(() => builder.links('[unknown](missing.md)', 'docs/CLI.md')).toThrow('Undocumented link target');
        expect(() => new Documentation(root, '../release')).toThrow('exact package version');
        expect(() => new Documentation(root, version)).toThrow('Move unreleased changes');
    });

    test('chooses fences that preserve nested Markdown and trailing newlines', () => {
        expect(fence('hello\n', 'text')).toBe('```text\nhello\n```');
        expect(fence('```tsx\n<b />\n```\n', 'md')).toBe('````md\n```tsx\n<b />\n```\n````');
        expect(fence('~~~~\n``````', 'text')).toMatch(/^```````text/);
    });

    test('release builds use pinned commands and reject unreleased changelog claims', () => {
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-docs-release-'));
        try {
            copyDocumentationSource(root, temporary);
            const packageFile = path.join(temporary, 'package.json');
            const packageData = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
            packageData.devDependencies.typescript = '5.1.0';
            packageData.devDependencies.zod = '4.0.0';
            packageData.dependencies.ws = '8.0.0';
            fs.writeFileSync(packageFile, JSON.stringify(packageData));
            fs.writeFileSync(path.join(temporary, 'CHANGELOG.md'), `# Changelog\n\n## Unreleased\n\n## ${version}\n\n- Released.\n`);
            const docs = new Documentation(temporary, version).build();
            expect(docs.llms).toContain(`Documentation for Redweb ${version}`);
            expect(docs.pages.find(page => page.id === 'recipes/realtime').markdown).toContain(`npx --yes redweb@${version} init`);
            expect(docs.pages.find(page => page.id === 'recipes/realtime').markdown).not.toContain('TARBALL');
            const socketManifest = JSON.parse(docs.pages.find(page => page.id === 'recipes/socket').files.find(file => file.path === 'package.json').content);
            expect(socketManifest.devDependencies.typescript).toBe('5.1.0');
            expect(socketManifest.devDependencies.ws).toBe('8.0.0');
            expect(socketManifest.dependencies.zod).toBe('4.0.0');
            const referencePath = path.join(temporary, 'docs/reference.json');
            const reference = JSON.parse(fs.readFileSync(referencePath, 'utf8'));
            reference.api[0].recipe = { template: 'realtime', file: 'missing.tsx' };
            fs.writeFileSync(referencePath, JSON.stringify(reference));
            expect(() => new Documentation(temporary, version).build()).toThrow('Unknown documentation recipe file');
            fs.copyFileSync(path.join(root, 'docs/reference.json'), referencePath);
            fs.writeFileSync(path.join(temporary, 'CHANGELOG.md'), `# Changelog\n\n## ${version}\n\n- Released.\n`);
            expect(new Documentation(temporary, version).build().channel).toBe(version);
            fs.writeFileSync(path.join(temporary, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n\n- Pending.\n');
            expect(() => new Documentation(temporary, version)).toThrow('Move unreleased changes');
            fs.writeFileSync(path.join(temporary, 'CHANGELOG.md'), '# Changelog\n');
            expect(() => new Documentation(temporary, version)).toThrow('versioned changelog section');
            fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ version: '../../escape' }));
            expect(() => new Documentation(temporary)).toThrow('valid package version');
        } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
    });
});
