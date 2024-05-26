const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const https = require('https');
const loadSslConfig = require('./sslConfig');

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
 */

const ENCODINGS = { json: 'json', urlencoded: 'urlencoded' };
const METHODS = { POST: 'post', GET: 'get' };

const HTTP_OPTIONS = {
    port: 80,
    bind: '0.0.0.0',
    publicPaths: ['./public'],
    services: [],
    listenCallback: undefined,
    encoding: ENCODINGS.json,
    ssl: null
};

/**
 * Base HTTP Server
 * @param {RedWebOptions} options - Configuration options for RedWeb.
 * @return {Object} Express application instance.
 */
function BaseHttpServer(options = {}) {
    this.options = { ...HTTP_OPTIONS, ...options };
    this.app = express();
    Object.assign(this, this.options);

    // Middleware to parse request bodies based on the specified encoding
    if (this.encoding === ENCODINGS.json) {
        this.app.use(bodyParser.json());
    } else if (this.encoding === ENCODINGS.urlencoded) {
        this.app.use(bodyParser.urlencoded({ extended: true }));
    }

    this.services.forEach(service => this.app[service.method](service.serviceName, service.function));
    this.publicPaths.forEach(public_path => this.app.use(express.static(path.join(process.cwd(), public_path))));
}

/**
 * HTTP Server
 * @param {RedWebOptions} options - Configuration options for RedWeb.
 * @return {Object} Express application instance.
 */
function HttpServer(options = {}) {
    BaseHttpServer.call(this, options);
    this.app.listen(this.port, this.listenCallback ? this.listenCallback : () => console.log(`RedWeb HttpServer listening on port ${this.port}`));
    return this;
}

/**
 * HTTPS Server
 * @param {RedWebOptions} options - Configuration options for RedWeb.
 * @return {Object} Express application instance.
 */
function HttpsServer(options = {}) {
    BaseHttpServer.call(this, options);
    const sslOptions = loadSslConfig(this.ssl);
    https.createServer(sslOptions, this.app).listen(this.port, this.listenCallback ? this.listenCallback : () => console.log(`RedWeb HttpsServer listening on port ${this.port}`));
    return this;
}

module.exports = {
    HttpServer,
    HttpsServer,
    ENCODINGS,
    METHODS,
    HTTP_OPTIONS
};
