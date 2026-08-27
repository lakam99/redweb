const fs = require('fs');
const path = require('path');
const { PageManager } = require('./PageManager');

function pageFile(outDir, route) {
    if (!/^\/(?:[A-Za-z0-9._~-]+\/?)*$/.test(route) || route.split('/').some(part => part === '.' || part === '..')) {
        throw new TypeError(`Static page path cannot be exported: ${route}`);
    }
    const relative = route === '/' ? 'index.html' : path.join(route.slice(1), 'index.html');
    return path.join(outDir, relative);
}

function write(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
}

async function exportStatic(pageOrPages, options = {}) {
    const pages = Array.isArray(pageOrPages) ? pageOrPages : [pageOrPages];
    if (!pages.length || pages.some(PageClass => typeof PageClass !== 'function')) {
        throw new TypeError('exportStatic() requires a page class or a non-empty array of page classes.');
    }
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError('exportStatic() options must be an object.');
    }
    const { outDir, templateRoot, logger = console } = options;
    if (typeof outDir !== 'string' || !outDir) throw new TypeError('exportStatic() requires a non-empty outDir.');
    const root = path.resolve(outDir);
    const manager = new PageManager({ pages, templateRoot, logger });
    const writtenPages = [];
    const writtenAssets = [];
    const pageFiles = new Set();
    try {
        for (const record of manager.records.values()) {
            if (record.metadata.live !== false) {
                throw new Error(`Static export requires live: false on ${record.PageClass.name}.`);
            }
            const request = Object.freeze({
                url: record.metadata.path,
                headers: Object.freeze({ host: 'localhost' }),
                params: Object.freeze({}),
                query: Object.freeze({}),
                body: undefined,
            });
            const file = pageFile(root, record.metadata.path);
            if (pageFiles.has(file)) throw new Error(`Static page paths resolve to the same output file: ${file}`);
            pageFiles.add(file);
            write(file, await manager.render(record, request));
            writtenPages.push(file);
        }
        for (const [url, content] of manager.stylesheets) {
            const file = path.join(root, ...url.slice(1).split('/'));
            write(file, content);
            writtenAssets.push(file);
        }
        return Object.freeze({ pages: Object.freeze(writtenPages), assets: Object.freeze(writtenAssets) });
    } finally {
        await manager.shutdown();
    }
}

module.exports = { exportStatic };
