const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

/**
 * @typedef {'json' | 'urlencoded'} RedWebEncoding
 */

/**
 * RedWeb options object.
 * @typedef {Object} RedWebOptions
 * @property {number} [port=80] - The port number to bind the server.
 * @property {string} [bind='0.0.0.0'] - The bind address for the server.
 * @property {string[]} [publicPaths=['./public']] - An array of paths to serve static files from.
 * @property {Array<{serviceName: string, method: string, function: Function}>} [services=[]] - An array of services with their endpoints and handlers.
 * @property {Function} [listenCallback] - Callback function to execute once the server starts listening.
 * @property {RedWebEncoding} [encoding='json'] - The encoding type for the request bodies ('json' or 'urlencoded').
 * @property {Object} [ssl] - SSL configuration for HTTPS server.
 * @property {string} [ssl.key] - Path to the SSL key file.
 * @property {string} [ssl.cert] - Path to the SSL certificate file.
 * @property {import('express').Application} [server] - Whether to automatically start listening.
 * @property {import('cors').CorsOptions} [corsOptions] - The CORS Options.
 * @property {boolean} [enableDynamicRendering=true] - Enable dynamic page rendering from `pages/` directory.
 */

const ENCODINGS = { json: 'json', urlencoded: 'urlencoded' };
const HTTP_OPTIONS = {
    port: 80,
    bind: '0.0.0.0',
    publicPaths: ['./public'],
    services: [],
    listenCallback: undefined,
    encoding: ENCODINGS.json,
    ssl: null,
    server: undefined,
    corsOptions: undefined,
    enableDynamicRendering: true, // Enable dynamic rendering of pages
};

/**
 * Base HTTP Server
 * @param {RedWebOptions} options - Configuration options for RedWeb.
 * @return {Object} Express application instance.
 */
function BaseHttpServer(options = {}) {
    this.options = { ...HTTP_OPTIONS, ...options };
    this.app = express() || this.options.server;
    Object.assign(this, this.options);

    // Middleware to parse request bodies based on the specified encoding
    if (this.encoding === ENCODINGS.json) {
        this.app.use(bodyParser.json());
    } else if (this.encoding === ENCODINGS.urlencoded) {
        this.app.use(bodyParser.urlencoded({ extended: true }));
    }

    this.app.use(cors(this.options.corsOptions));

    // Resolve the directory of the script that runs the server
    const serverRoot = path.dirname(require.main.filename);

    // Serve static files from public paths
    this.publicPaths.forEach((publicPath) =>
        this.app.use(express.static(path.resolve(serverRoot, publicPath)))
    );

    // Enable dynamic rendering if the flag is set
    if (this.enableDynamicRendering) {
        const pagesDir = path.resolve(serverRoot, 'pages');

        if (fs.existsSync(pagesDir)) {
            this.app.get('*', async (req, res) => {
                const route = req.path === '/' ? '/index' : req.path;
                const pagePath = path.join(pagesDir, `${route}.js`);

                if (fs.existsSync(pagePath)) {
                    try {
                        const page = require(pagePath);

                        if (typeof page !== 'function') {
                            throw new Error(`Page module at ${route} does not export a function.`);
                        }

                        const html = await page(req); // Execute the page function with the request object
                        res.send(html); // Send the rendered HTML
                    } catch (err) {
                        res.status(500).send(`<h1>Error rendering page</h1><pre>${err.message}</pre>`);
                    }
                } else {
                    res.status(404).send('<h1>Page Not Found</h1>');
                }
            });
        } else {
            console.warn(`Pages directory not found: ${pagesDir}`);
        }
    }

    // Add custom services
    const catchAll = this.services.find((service) => service.serviceName === '*');
    if (catchAll) this.services.splice(this.services.indexOf(catchAll), 1);
    this.services.forEach((service) =>
        this.app[service.method](service.serviceName, service.function)
    );
    if (catchAll) this.app[catchAll.method](catchAll.serviceName, catchAll.function);

    return this;
}

module.exports = {
    BaseHttpServer,
    ENCODINGS,
    HTTP_OPTIONS,
    METHODS: { GET: 'get', POST: 'post', PUT: 'put', DELETE: 'delete' },
};
