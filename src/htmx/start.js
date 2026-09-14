const LiveHtmlServer = require('./LiveHtmlServer');

function start(pageOrPages, options = {}) {
    const pages = Array.isArray(pageOrPages) ? pageOrPages : [pageOrPages];
    if (!pages.length || pages.some(PageClass => typeof PageClass !== 'function')) {
        throw new TypeError('start() requires a page class or a non-empty array of page classes.');
    }
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError('start() options must be an object.');
    }
    return new LiveHtmlServer({
        ...options,
        pages,
    });
}

module.exports = { start };
