const express = require('express');
const path = require('path');
const cors = require('cors');
const { validateListenerOptions } = require('../serverLifecycle');

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
 * @property {boolean} [listen=true] - Whether HttpServer/HttpsServer should automatically start listening.
 * @property {Function} [listenCallback] - Callback function to execute once the server starts listening.
 * @property {RedWebEncoding} [encoding='json'] - The encoding type for the request bodies ('json' or 'urlencoded').
 * @property {Object} [ssl] - SSL configuration for HTTPS server.
 * @property {string} [ssl.key] - Path to the SSL key file.
 * @property {string} [ssl.cert] - Path to the SSL certificate file.
 * @property {import('express').Application} [server] - Existing Express application to configure.
 * @property {import('cors').CorsOptions} [corsOptions] - The CORS Options.
 */

const ENCODINGS = { json: 'json', urlencoded: 'urlencoded' };
const HTTP_OPTIONS = {
    port: 80,
    bind: '0.0.0.0',
    publicPaths: ['./public'],
    services: [],
    listen: true,
    listenCallback: undefined,
    encoding: ENCODINGS.json,
    ssl: null,
    server: undefined,
    corsOptions: undefined,
    exposeErrors: false,
    logger: console,
};

function assertOptions(options) {
    validateListenerOptions(options);
    if (!Object.values(ENCODINGS).includes(options.encoding)) {
        throw new TypeError('`encoding` must be either "json" or "urlencoded".');
    }
    if (!Array.isArray(options.publicPaths)) {
        throw new TypeError('`publicPaths` must be an array.');
    }
    if (options.publicPaths.some(publicPath => typeof publicPath !== 'string' || !publicPath)) {
        throw new TypeError('Every public path must be a non-empty string.');
    }
    if (!Array.isArray(options.services)) {
        throw new TypeError('`services` must be an array.');
    }

    options.services.forEach((service) => {
        if (!service || typeof service.serviceName !== 'string' || !service.serviceName) {
            throw new TypeError('Every service must have a non-empty `serviceName`.');
        }
        if (!['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'all'].includes(service.method)) {
            throw new TypeError(`Unsupported HTTP service method: ${service.method}`);
        }
        if (typeof service.function !== 'function') {
            throw new TypeError(`Service ${service.serviceName} must provide a function.`);
        }
    });
    if (options.services.filter(service => service.serviceName === '*').length > 1) {
        throw new TypeError('Only one catch-all service may be registered.');
    }
}

/**
 * Base HTTP Server
 * @param {RedWebOptions} options - Configuration options for RedWeb.
 * @return {Object} Express application instance.
 */
function BaseHttpServer(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError('HTTP server options must be an object.');
    }
    const mergedOptions = { ...HTTP_OPTIONS, ...options };
    assertOptions(mergedOptions);
    this.options = {
        ...mergedOptions,
        publicPaths: [...mergedOptions.publicPaths],
        services: [...mergedOptions.services],
    };
    this.app = this.options.server === undefined ? express() : this.options.server;
    if (typeof this.app.use !== 'function') {
        throw new TypeError('`server` must be an Express-compatible application.');
    }
    Object.assign(this, this.options);

    // Middleware to parse request bodies based on the specified encoding
    if (this.encoding === ENCODINGS.json) {
        this.app.use(express.json());
    } else {
        this.app.use(express.urlencoded({ extended: true }));
    }

    if (this.options.corsOptions !== false) {
        this.app.use(cors(this.options.corsOptions));
    }

    // Serve static files from public paths
    this.publicPaths.forEach((publicPath) =>
        this.app.use(express.static(path.resolve(process.cwd(), publicPath)))
    );

    const catchAll = this.services.find((service) => service.serviceName === '*');
    this.services.filter((service) => service !== catchAll).forEach((service) =>
        this.app[service.method](service.serviceName, service.function)
    );
    if (catchAll) this.app[catchAll.method](catchAll.serviceName, catchAll.function);

    return this;
}


module.exports = {
    BaseHttpServer,
    ENCODINGS,
    HTTP_OPTIONS,
    METHODS: { GET: 'get', POST: 'post', PUT: 'put', PATCH: 'patch', DELETE: 'delete', OPTIONS: 'options', HEAD: 'head', ALL: 'all' },
};
