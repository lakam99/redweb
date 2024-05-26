const fs = require('fs');

/**
 * Load SSL configuration
 * @param {Object} sslOptions - The SSL options object containing the paths to key and cert files.
 * @param {string} sslOptions.key - Path to the SSL key file.
 * @param {string} sslOptions.cert - Path to the SSL certificate file.
 * @return {Object} - The loaded SSL options containing key and cert.
 */
function loadSslConfig(sslOptions) {
    if (!sslOptions || !sslOptions.key || !sslOptions.cert) {
        throw new Error('SSL key and certificate paths must be provided');
    }
    return {
        key: fs.readFileSync(sslOptions.key),
        cert: fs.readFileSync(sslOptions.cert)
    };
}

module.exports = loadSslConfig;
