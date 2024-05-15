const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

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
 */

const ENCODINGS = { json: 'json', urlencoded: 'urlencoded' };
const METHODS = { POST: 'post', GET: 'get' };

const DEFAULT_OPTIONS = {
    port: 80,
    bind: '0.0.0.0',
    publicPaths: ['./public'],
    services: [],
    listenCallback: undefined,
    encoding: ENCODINGS.json
};

/**
 * To get started with RedWeb, simply initialize your RedWeb instance:
 * ```javascript
 * const app = new RedWeb();
 * ```
 * You can also configure it according to your needs:
 * ```javascript
 * const app = new RedWeb({
 *     port: 3000,
 *     publicPaths: [
 *         './pages/my_public_html',
 *         './content/my_public_images',
 *         './styles/styles.css'
 *     ],
 *     encoding: 'urlencoded'
 * });
 * ```
 * @param {RedWebOptions} options - Configuration options for RedWeb.
 * @return {RedWeb}
 */
function RedWeb(options = {}) {
    options = { ...DEFAULT_OPTIONS, ...options };
    const app = express();
    const { publicPaths, port, listenCallback, services, encoding } = options;

    // Middleware to parse request bodies based on the specified encoding
    if (encoding === ENCODINGS.json) {
        app.use(bodyParser.json());
    } else if (encoding === ENCODINGS.urlencoded) {
        app.use(bodyParser.urlencoded({ extended: true }));
    }

    services.forEach(service => app[service.method](service.serviceName, service.function));
    publicPaths.forEach(public_path => app.use(express.static(path.join(process.cwd(), public_path))));
    app.listen(port, listenCallback ? listenCallback : () => console.log(`RedWeb listening on port ${port}`));
    return app;
}

module.exports = { RedWeb, METHODS, DEFAULT_OPTIONS };
