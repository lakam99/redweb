const fs = require('fs');
const path = require('path');
const { PageManager } = require('./PageManager');
const { getPageMetadata } = require('./metadata');

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function pageFile(outDir, route) {
    const segments = route.split('/').filter(Boolean);
    if (!/^\/(?:[A-Za-z0-9._~-]+\/?)*$/.test(route) ||
        segments.some(part => part === '.' || part === '..' || part.endsWith('.') || WINDOWS_RESERVED.test(part))) {
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
    const pageFiles = new Set();
    const preflight = pages.map(PageClass => {
        const metadata = getPageMetadata(PageClass);
        if (!metadata) throw new TypeError(`${PageClass.name || 'Page'} is missing @page metadata.`);
        if (metadata.live !== false) throw new Error(`Static export requires live: false on ${PageClass.name}.`);
        if (metadata.policy) throw new Error(`Authorized pages cannot be exported: ${PageClass.name}.`);
        const file = pageFile(root, metadata.path);
        const key = path.relative(root, file).replaceAll('\\', '/').toLowerCase();
        if (pageFiles.has(key)) throw new Error(`Static page paths resolve to the same output file: ${file}`);
        pageFiles.add(key);
        return { metadata, file };
    });
    const manager = new PageManager({ pages, templateRoot, logger });
    try {
        const pagePlan = preflight.map(({ metadata, file }) => ({ record: manager.records.get(metadata.path), file }));
        const assetPlan = [...manager.stylesheets].map(([url, content]) => ({
            file: path.join(root, ...url.slice(1).split('/')),
            content,
        }));
        const renderedPages = [];
        for (const entry of pagePlan) {
            const { record, file } = entry;
            const request = Object.freeze({
                path: record.metadata.path,
                url: record.metadata.path,
                method: 'GET',
                headers: Object.freeze({}),
                params: Object.freeze({}),
                query: Object.freeze({}),
                body: undefined,
            });
            renderedPages.push({ file, content: await manager.render(record, request) });
        }
        renderedPages.forEach(entry => write(entry.file, entry.content));
        assetPlan.forEach(entry => write(entry.file, entry.content));
        return Object.freeze({
            pages: Object.freeze(renderedPages.map(entry => entry.file)),
            assets: Object.freeze(assetPlan.map(entry => entry.file)),
        });
    } finally {
        await manager.shutdown();
    }
}

module.exports = { exportStatic };
