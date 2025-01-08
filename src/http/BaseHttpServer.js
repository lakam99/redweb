const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const HtmxRenderer = require('../htmx/HtmxRenderer'); // Import the HtmxRenderer module

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
 * @property {boolean} [enableHtmxRendering=false] - Enable dynamic HTMX file rendering.
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
    enableHtmxRendering: false, // New option for HTMX rendering
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

    // Enable HTMX rendering if the flag is set
    if (this.enableHtmxRendering) {
        this.app.get('*.htmx', (req, res) => {
            // Find the file in one of the publicPaths
            const filePath = this.publicPaths
                .map(publicPath => path.join(process.cwd(), publicPath, req.path))
                .find(fullPath => fs.existsSync(fullPath)); // Check if the file exists
    
            if (!filePath) {
                return res.status(404).send(`Error rendering HTMX file: Template file not found: ${req.path}`);
            }
    
            try {
                const renderedContent = HtmxRenderer.render(filePath);
                res.type('html').send(renderedContent);
            } catch (error) {
                res.status(500).send(`Error rendering HTMX file: ${error.message}`);
            }
        });
    }
    

    // Serve static files from public paths
    this.publicPaths.forEach((publicPath) =>
        this.app.use(express.static(path.join(process.cwd(), publicPath)))
    );

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
