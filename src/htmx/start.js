const path = require('path');
const LiveHtmlServer = require('./LiveHtmlServer');

function exportedClass(moduleExports, PageClass) {
    return Object.values(Object.getOwnPropertyDescriptors(Object(moduleExports)))
        .some(descriptor => descriptor.value === PageClass);
}

function inferTemplateRoot(pages) {
    const roots = new Set();
    Object.values(require.cache).forEach(moduleRecord => {
        if (pages.some(PageClass => exportedClass(moduleRecord.exports, PageClass))) {
            roots.add(path.dirname(moduleRecord.filename));
        }
    });
    return roots.size === 1 ? [...roots][0] : process.cwd();
}

function start(pageOrPages, options = {}) {
    const pages = Array.isArray(pageOrPages) ? pageOrPages : [pageOrPages];
    if (!pages.length || pages.some(PageClass => typeof PageClass !== 'function')) {
        throw new TypeError('start() requires a page class or a non-empty array of page classes.');
    }
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError('start() options must be an object.');
    }
    return new LiveHtmlServer({
        templateRoot: inferTemplateRoot(pages),
        ...options,
        pages,
    });
}

module.exports = { start };
