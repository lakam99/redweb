'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { verifyApplication } = require('./verify-starter');

function verifyDocumentation(packageRoot, workspace) {
    const catalogue = JSON.parse(fs.readFileSync(path.join(packageRoot, 'docs/generated.json'), 'utf8'));
    const { Documentation } = require(path.join(packageRoot, 'src/docs/Documentation'));
    assert.deepEqual(catalogue, new Documentation(packageRoot, catalogue.channel).build(), 'Packed docs must match packed code.');
    const reports = [];
    for (const page of catalogue.pages.filter(page => page.files)) {
        const template = page.id.split('/')[1];
        const target = path.join(workspace, `documented-${template}`);
        fs.mkdirSync(target);
        // Execute the code actually printed in Markdown, not a second copy from the JSON file list.
        const extracted = [...page.markdown.matchAll(/^### ([\w./-]+)\n\n(`{3,})\w+\n([\s\S]*?)\n\2(?=\n|$)/gm)];
        assert.deepEqual(extracted.map(match => match[1]), page.files.map(file => file.path));
        for (const [index, match] of extracted.entries()) {
            assert.equal(match[3], page.files[index].content.trimEnd());
            const destination = path.resolve(target, match[1]);
            assert.ok(destination.startsWith(`${target}${path.sep}`), 'Recipe file escapes its application directory.');
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.writeFileSync(destination, `${match[3]}\n`, { flag: 'wx' });
        }
        reports.push({ template, output: verifyApplication(packageRoot, target, template) });
    }
    const { TEMPLATES } = require(path.join(packageRoot, 'src/cli/templates'));
    assert.deepEqual(reports.map(report => report.template), TEMPLATES, 'Every documented recipe must run.');
    return reports;
}

module.exports = { verifyDocumentation };
