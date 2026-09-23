'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { exportStatic, page } = require('../..');

test('static export cannot write through a linked output directory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-export-boundary-'));
    const output = path.join(root, 'output');
    const privateDir = path.join(root, 'private');
    const link = path.join(output, 'linked');
    fs.mkdirSync(output);
    fs.mkdirSync(privateDir);
    fs.writeFileSync(path.join(privateDir, 'sentinel.txt'), 'private');
    try {
        fs.symlinkSync(privateDir, link, 'junction');
        class StaticPage { render() { return '<p>exported</p>'; } }
        page('/linked', { live: false })(StaticPage);
        await expect(exportStatic(StaticPage, { outDir: output, logger: null }))
            .rejects.toThrow('outside the configured output directory');
        expect(fs.readFileSync(path.join(privateDir, 'sentinel.txt'), 'utf8')).toBe('private');
        expect(fs.existsSync(path.join(privateDir, 'index.html'))).toBe(false);
    } finally {
        if (fs.existsSync(link)) {
            if (process.platform === 'win32') fs.rmdirSync(link);
            else fs.unlinkSync(link);
        }
        fs.unlinkSync(path.join(privateDir, 'sentinel.txt'));
        fs.rmdirSync(privateDir);
        fs.rmdirSync(output);
        fs.rmdirSync(root);
    }
});

test('static export replaces a hard-linked output without modifying the private file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-export-file-boundary-'));
    const output = path.join(root, 'output');
    const privateFile = path.join(root, 'private.html');
    const link = path.join(output, 'index.html');
    fs.mkdirSync(output);
    fs.writeFileSync(privateFile, 'private');
    try {
        fs.linkSync(privateFile, link);
        class StaticPage { render() { return '<p>exported</p>'; } }
        page('/', { live: false })(StaticPage);
        await exportStatic(StaticPage, { outDir: output, logger: null });
        expect(fs.readFileSync(privateFile, 'utf8')).toBe('private');
        expect(fs.readFileSync(link, 'utf8')).toContain('exported');
    } finally {
        if (fs.existsSync(link)) fs.unlinkSync(link);
        fs.unlinkSync(privateFile);
        fs.rmdirSync(output);
        fs.rmdirSync(root);
    }
});

test('static export removes its temporary file if the destination cannot be replaced', async () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-export-failure-'));
    fs.mkdirSync(path.join(output, 'index.html'));
    try {
        class StaticPage { render() { return '<p>exported</p>'; } }
        page('/', { live: false })(StaticPage);
        await expect(exportStatic(StaticPage, { outDir: output, logger: null })).rejects.toThrow();
        expect(fs.readdirSync(output)).toEqual(['index.html']);
    } finally {
        fs.rmdirSync(path.join(output, 'index.html'));
        fs.rmdirSync(output);
    }
});

test('static export refuses an authorized page before writing output', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-protected-export-'));
    const output = path.join(root, 'output');
    try {
        class SecretPage { render() { return '<p>private</p>'; } }
        page('/secret', { live: false, authorize: () => true })(SecretPage);
        await expect(exportStatic(SecretPage, { outDir: output, logger: null }))
            .rejects.toThrow('Authorized pages cannot be exported');
        expect(fs.existsSync(output)).toBe(false);
    } finally { fs.rmdirSync(root); }
});
