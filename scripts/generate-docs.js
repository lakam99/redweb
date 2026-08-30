'use strict';

const fs = require('fs');
const path = require('path');
const { Documentation, fence } = require('../src/docs/Documentation');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
if (args.some(arg => !['--check', '--release'].includes(arg)) || new Set(args).size !== args.length) {
    throw new Error('Usage: node scripts/generate-docs.js [--check] [--release]');
}
const target = path.join(root, 'docs', 'generated.json');
const channel = args.includes('--release') ? require('../package.json').version
    : args.includes('--check') && fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')).channel : 'unreleased';
const catalogue = new Documentation(root, channel).build();
const output = JSON.stringify(catalogue, null, 2) + '\n';
const readmePath = path.join(root, 'README.md');
const readme = fs.readFileSync(readmePath, 'utf8').replace(/\r\n/g, '\n');
const region = /<!-- redweb:realtime:start -->[\s\S]*?<!-- redweb:realtime:end -->/g;
if ([...readme.matchAll(region)].length !== 1) throw new Error('README must contain exactly one realtime recipe region.');
const snippet = catalogue.pages.find(page => page.id === 'recipes/realtime').files.find(file => file.path === 'src/app.tsx').content;
const generatedReadme = readme.replace(region, () => `<!-- redweb:realtime:start -->\n${fence(snippet, 'tsx')}\n<!-- redweb:realtime:end -->`);
if (args.includes('--check')) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== output) {
        throw new Error('Generated documentation is stale. Run npm run generate:docs.');
    }
    if (readme !== generatedReadme) throw new Error('README recipe is stale. Run npm run generate:docs.');
} else {
    if (args.includes('--release')) {
        const snapshot = path.join(root, 'docs', 'releases', `${channel}.json`);
        if (fs.existsSync(snapshot) && fs.readFileSync(snapshot, 'utf8').replace(/\r\n/g, '\n') !== output) {
            throw new Error('Release documentation is immutable. Change the package version instead of overwriting its snapshot.');
        }
        fs.mkdirSync(path.dirname(snapshot), { recursive: true });
        if (!fs.existsSync(snapshot)) fs.writeFileSync(snapshot, output, { flag: 'wx' });
    }
    fs.writeFileSync(target, output);
    fs.writeFileSync(readmePath, generatedReadme);
}
// Keep npm pack --json stdout machine-readable when this runs as a lifecycle hook.
console.error(`Documentation ${args.includes('--check') ? 'checked' : 'generated'}: ${catalogue.pages.length} pages (${channel}).`);
