'use strict';

const { randomUUID } = require('crypto');
const { PageManager } = require('../htmx/PageManager');
const TemplateRenderer = require('../htmx/TemplateRenderer');
const loopbackRequest = require('./loopbackRequest');
const refreshBrowser = require('./refreshBrowser');

const PATHS = Object.freeze({ developmentRevision: '/__redweb/development', developmentRuntime: '/__redweb/development.js', developmentStyles: '/__redweb/development.css' });

class DevelopmentPageManager extends PageManager {
    constructor(options) {
        super(options, PATHS);
        this.revision = randomUUID();
    }

    mount(app) {
        const serve = (type, content) => (request, response) => {
            response.set('Cache-Control', 'private, no-store').set('X-Content-Type-Options', 'nosniff');
            response.removeHeader('Access-Control-Allow-Origin');
            if (!loopbackRequest(request)) { response.status(404).end(); return; }
            response.type(type).end(content);
        };
        app.get(PATHS.developmentRevision, serve('application/json', JSON.stringify({ revision: this.revision })));
        app.get(PATHS.developmentRuntime, serve('text/javascript', refreshBrowser()));
        app.get(PATHS.developmentStyles, serve('text/css', require('./refreshStyles')));
        super.mount(app);
    }

    createDocument(record, request) {
        const document = super.createDocument(record, request);
        if (!loopbackRequest(request)) return document;
        // Capture only a declaration string, never the HTTP request or credentials.
        const bootstrap = `<rw-dev-refresh id="__redweb_dev"></rw-dev-refresh><script type="module" src="${PATHS.developmentRuntime}?revision=${this.revision}"></script>`;
        return (markup, config) => {
            const html = document(markup, config);
            const body = TemplateRenderer.closingTag(html, 'body');
            return body < 0 ? html + bootstrap : html.slice(0, body) + bootstrap + html.slice(body);
        };
    }

    respond(record, request, response, markup) {
        if (!loopbackRequest(request)) return super.respond(record, request, response, markup);
        response.set('Cache-Control', 'private, no-store').type('html').end(markup);
    }
}

module.exports = DevelopmentPageManager;
