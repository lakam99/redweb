'use strict';

const fs = require('fs');
const path = require('path');
const { Documentation, fence } = require('../src/docs/Documentation');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const releaseCheck = args.includes('--release-check');
if (args.some(arg => !['--check', '--release', '--release-check'].includes(arg))
    || new Set(args).size !== args.length || releaseCheck && args.length !== 1) {
    throw new Error('Usage: node scripts/generate-docs.js [--check] [--release] | --release-check');
}
const target = path.join(root, 'docs', 'generated.json');
const checking = args.includes('--check') || releaseCheck;
const channel = args.includes('--release') ? require('../package.json').version
    : checking && fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')).channel : 'unreleased';
const documentation = new Documentation(root, channel);
const catalogue = documentation.build();
const output = JSON.stringify(catalogue, null, 2) + '\n';
const readmePath = path.join(root, 'README.md');
const readme = fs.readFileSync(readmePath, 'utf8').replace(/\r\n/g, '\n');
const regions = ['realtime', 'setup', 'http-ws'].map(name => {
    const start = `<!-- redweb:${name}:start -->`;
    const end = `<!-- redweb:${name}:end -->`;
    const region = new RegExp(`${start}[\\s\\S]*?${end}`, 'g');
    const matches = [...readme.matchAll(region)];
    if (readme.split(start).length !== 2 || readme.split(end).length !== 2 || matches.length !== 1) {
        throw new Error(`README must contain exactly one ${name} recipe region.`);
    }
    const content = name === 'setup' ? `${documentation.notice()}\n\n${documentation.setup('realtime')}`
        : fence(catalogue.pages.find(page => page.id === `recipes/${name}`).files.find(file => file.path === 'src/app.tsx').content, 'tsx');
    return { region, index: matches[0].index, length: matches[0][0].length, content: `${start}\n${content}\n${end}` };
});
const ordered = [...regions].sort((left, right) => left.index - right.index);
for (let index = 1; index < ordered.length; index++) {
    if (ordered[index - 1].index + ordered[index - 1].length > ordered[index].index) {
        throw new Error('README recipe regions must not overlap or nest.');
    }
}
const generatedReadme = regions.reduce((markdown, { region, content }) => markdown.replace(region, () => content), readme);
if (checking) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== output) {
        throw new Error('Generated documentation is stale. Run npm run generate:docs.');
    }
    if (readme !== generatedReadme) throw new Error('README recipe is stale. Run npm run generate:docs.');
    if (releaseCheck) {
        const version = require('../package.json').version;
        if (channel !== version) {
            throw new Error(`Release documentation channel ${channel} does not match package version ${version}. Run npm run generate:docs -- --release.`);
        }
        const snapshot = path.join(root, 'docs', 'releases', `${version}.json`);
        if (!fs.existsSync(snapshot) || fs.readFileSync(snapshot, 'utf8').replace(/\r\n/g, '\n') !== output) {
            throw new Error(`Release documentation snapshot ${version} is missing or stale. Run npm run generate:docs -- --release.`);
        }
    }
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
console.error(`Documentation ${checking ? 'checked' : 'generated'}: ${catalogue.pages.length} pages (${channel}).`);
