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
    test('operational guidance distinguishes blocking server recovery from the original diagnostic', () => {
        const docs = new Documentation(root).build();
        const operations = docs.pages.find(page => page.id === 'operations').markdown;
        const [acceptance, diagnostic] = operations.split('## Original recovery diagnostic');
        expect(acceptance).toContain('npm run verify:recovery:server');
        expect(acceptance).toContain('server-steady-v1');
        expect(acceptance).toContain('7,400');
        expect(acceptance).toContain('client heap is diagnostic');
        expect(acceptance).toContain('rejects workload overrides');
        expect(acceptance).not.toContain('REDWEB_RECOVERY_WARM_CONNECTIONS');
        expect(acceptance).not.toContain('redweb-0.8-baseline');
        expect(diagnostic).toContain('npm run verify:recovery');
        expect(diagnostic).toContain('non-blocking');
        expect(diagnostic).toContain('REDWEB_RECOVERY_WARM_CONNECTIONS');
        const contract = docs.pages.find(page => page.id === 'production-contract').markdown;
        expect(contract).toContain('warmed **server** heap');
        expect(contract).toContain('original shared-process diagnostic');
        expect(contract).not.toContain('are compared against 0.8 by the performance gate');
    });

    test('match showcase reuses complete session handlers and keeps private rooms separate', () => {
        const docs = new Documentation(root).build();
        const example = docs.examples.find(entry => entry.id === 'rooms-sessions');
        expect(example.recipe).toEqual({ template: 'socket', file: 'src/handlers.ts' });
        expect(example.language).toBe('ts');
        const recipe = docs.pages.find(entry => entry.id === 'recipes/socket');
        expect(example.code).toBe(recipe.files.find(file => file.path === 'src/handlers.ts').content);
        expect(example.code).toContain('socket.createSession');
        expect(example.code).toContain('socket.resumeSession');
        expect(example.code).not.toContain('socket.context.principal.playerId');
        expect(docs.pages.find(entry => entry.id === 'examples/rooms-sessions').markdown)
            .toContain('](/docs/reference/unreleased/recipes/socket.md)');
        const guide = docs.pages.find(entry => entry.id === 'socket-contracts').markdown;
        for (const file of ['contract.ts', 'app.tsx', 'handlers.ts']) {
            expect(guide).toContain(`](/docs/reference/unreleased/recipes/socket/files/src/${file})`);
        }
        expect(guide).toContain('](/docs/reference/unreleased/room-authorization.md)');
        expect(guide).toContain('](/docs/reference/unreleased/examples/room-access.md)');
        const rooms = docs.examples.filter(entry => entry.codeSource === 'docs/snippets/room-access.tsx');
        expect(rooms).toHaveLength(1);
        expect(rooms[0].code).toBe(fs.readFileSync(path.join(root, rooms[0].codeSource), 'utf8').replace(/\r\n/g, '\n'));
    });

    test('generated socket README references its emitted source files without broken local links', () => {
        const files = projectFiles(version, 'socket');
        const readme = files.find(file => file.path === 'README.md').content;
        const paths = files.map(file => file.path);
        for (const [, target] of readme.matchAll(/\]\(([^\s)]+)\)/g)) {
            if (/^(?:https?:|#)/.test(target)) continue;
            expect(paths).toContain(path.posix.normalize(target.split('#')[0]));
        }
        for (const file of ['contract.ts', 'app.tsx', 'handlers.ts']) {
            expect(readme).toContain(`\`src/${file}\``);
            expect(paths).toContain(`src/${file}`);
        }
    });

    test('deployment guidance identifies the published release pair and future checkout boundary', () => {
        const guide = fs.readFileSync(path.join(root, 'docs/GETTING_STARTED.md'), 'utf8');
        expect(guide).toContain(`\`redweb@${version}\` installs published \`redweb-client@0.2.0\``);
        expect(guide).toContain('Future unreleased Redweb changes require their matching tested tarball');
        expect(guide).toContain('a clean production install does not preserve that link');
        expect(guide).not.toContain('as though the matching client were already published');
    });

    test('every generated README preserves the unpublished tarball prerequisite before installation', () => {
        for (const template of TEMPLATES) {
            const files = projectFiles(version, template);
            const manifest = JSON.parse(files.find(file => file.path === 'package.json').content);
            const readme = files.find(file => file.path === 'README.md').content.replace(/\r\n/g, '\n');
            expect(manifest.dependencies.redweb).toBe(`^${version}`);
            expect(readme).toContain('For an unreleased checkout or tarball');
            expect(readme).toContain('npm install --save-exact TARBALL');
            expect(readme.indexOf('npm install --save-exact TARBALL')).toBeLessThan(readme.indexOf('\nnpm install\n'));
            expect(readme).toContain('absolute path to the same tested Redweb tarball');
        }
    });

    test('published version agrees across package, lockfile, changelog and release guidance', () => {
        const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
        const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
        const trust = fs.readFileSync(path.join(root, 'docs/RELEASE_TRUST.md'), 'utf8');
        expect(lock.version).toBe(version);
        expect(lock.packages[''].version).toBe(version);
        expect(changelog).toContain(`## ${version}`);
        expect(trust).toContain(`npm install --save-exact redweb@${version}`);
        expect(trust).toContain('gitHead');
        expect(new Documentation(root).build().channel).toBe('unreleased');
    });

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
            expect(builder.setup(template)).not.toContain('npm link');
            expect(builder.setup(template)).toContain('no separate client checkout or linking is required');
            expect(recipe.markdown).toContain('development-only');
            expect(recipe.markdown).toContain('npm test');
            expect(recipe.markdown).toMatch(/No mocks|Integration tests use no mocks/);
            expect(recipe.markdown).toContain(builder.setup(template));
        }
        expect(docs.pages.find(page => page.id === 'recipes/dashboard').markdown)
            .toContain('A separately labelled unit test injects a cleanup error');
        const api = docs.pages.find(page => page.id === 'api-types').markdown;
        expect(api).toMatch(/export (?:interface|type) LiveHtmlServerOptions\b/);
        expect(api).toContain('SocketContract');
        const contract = docs.pages.find(page => page.id === 'socket-contracts').markdown;
        expect(contract).toContain('](/docs/reference/unreleased/recipes/socket.md)');
        expect(contract).toContain('](/docs/reference/unreleased/recipes/socket/files/src/contract.ts)');
        for (const section of docs.api) {
            const article = docs.pages.find(page => page.id === `api/${section.id}`);
            expect(article.markdown).toContain(section.usage.trimEnd());
            expect(article.markdown).toContain(section.article.eli5);
        }
        const guides = docs.pages.filter(page => page.id.startsWith('guides/'));
        expect(guides).toHaveLength(5);
        for (const guide of guides) {
            const recipe = docs.pages.find(page => page.id === `recipes/${guide.recipe.template}`);
            const file = recipe.files.find(file => file.path === guide.recipe.file);
            expect(guide.files).toBeUndefined();
            expect(guide.markdown).toContain(builder.setup(guide.recipe.template));
            expect(guide.markdown).toContain(file.content.trimEnd());
            expect(guide.markdown).toContain(`](${recipe.url})`);
            expect(guide.markdown).toContain("## Explain it like I'm five");
            expect(guide.markdown).toContain('## Check that it works');
        }
        expect(builder.setup('dashboard')).toContain('npm install --save-exact TARBALL\nnpm run add-user -- alice\nnpm test\nnpm run dev');
    });

    test('released documentation does not describe its shipped capabilities as unpublished', () => {
        const docs = JSON.parse(fs.readFileSync(path.join(root, `docs/releases/${version}.json`), 'utf8'));
        const text = [docs.llms, ...docs.pages.map(page => page.markdown)].join('\n');
        for (const stale of [
            'Redweb itself remains unreleased',
            'This command is currently **unreleased**',
            'This API is **unreleased**',
            'On this unreleased branch',
            'This checkout contains unreleased work even while its package metadata still matches an older npm version',
            'the current development candidate',
        ]) expect(text).not.toContain(stale);
        expect(text).toContain(`These commands are available in \`redweb@${version}\``);
        expect(text).toContain(`This API is available in \`redweb@${version}\``);
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
        expect(JSON.parse(fs.readFileSync(path.join(root, `docs/releases/${version}.json`), 'utf8')).channel).toBe(version);
        expect(() => builder.setup('../unknown')).toThrow('Unknown starter template');
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
            const builder = new Documentation(temporary, version);
            const docs = builder.build();
            for (const template of TEMPLATES) {
                expect(builder.setup(template)).toContain(`npx --yes redweb@${version} init my-${template} --template ${template}`);
                expect(builder.setup(template)).toContain(`cd my-${template}\nnpm install --save-exact redweb@${version}`);
                expect(builder.setup(template)).not.toContain('npm link');
                expect(docs.pages.find(page => page.id === `recipes/${template}`).markdown).toContain(builder.setup(template));
            }
            for (const guide of docs.pages.filter(page => page.id.startsWith('guides/'))) {
                expect(guide.markdown).toContain(`](/docs/reference/${version}/recipes/${guide.recipe.template}.md)`);
                expect(guide.markdown).not.toContain('/docs/reference/unreleased/');
                expect(guide.markdown).not.toContain('TARBALL');
            }
            expect(builder.setup('dashboard')).toContain(`npm install --save-exact redweb@${version}\nnpm run add-user -- alice\nnpm test\nnpm run dev`);
            expect(docs.llms).toContain(`Documentation for Redweb ${version}`);
            expect(docs.pages.find(page => page.id === 'recipes/realtime').markdown).toContain(`npx --yes redweb@${version} init`);
            // Published setup is registry-pinned. Its exact generated README
            // also documents the conditional unpublished-build prerequisite.
            expect(builder.setup('realtime')).not.toContain('TARBALL');
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
