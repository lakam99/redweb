'use strict';

const http = require('node:http');
const assert = require('node:assert/strict');
const { withTimeout } = require('../../tests/helpers/network');
const { verificationError } = require('./verificationError');

/** Read one bounded bootstrap response, releasing its non-pooled HTTP transport. */
async function readLiveHtmlPage(port) {
    let request, response, closed, timer, config;
    const failures = [];
    try {
        config = await new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error('Live HTML page response timed out.')), 10000);
            request = http.get({ host: '127.0.0.1', port, path: '/', agent: false }, incoming => {
                response = incoming;
                const chunks = [];
                let bytes = 0;
                response.on('error', reject);
                response.once('aborted', () => reject(new Error('Live HTML page response was aborted.')));
                response.on('data', chunk => {
                    bytes += chunk.length;
                    if (bytes > 1024 * 1024) {
                        reject(new Error('Live HTML page response exceeded 1 MiB.'));
                        response.destroy();
                    } else chunks.push(chunk);
                });
                response.once('end', () => {
                    try {
                        const match = Buffer.concat(chunks).toString('utf8')
                            .match(/<script type="application\/json" id="__redweb_page">([^<]+)<\/script>/);
                        assert(response.statusCode === 200 && match, 'Live HTML page render failed.');
                        const value = JSON.parse(match[1]);
                        assert(value && typeof value.pageId === 'string' && value.pageId.length > 0 &&
                            typeof value.socketPath === 'string' && /^\/(?!\/)[^?#]*$/.test(value.socketPath) &&
                            typeof value.version === 'string' && value.version.length > 0, 'Invalid Live HTML page configuration.');
                        resolve(value);
                    } catch (error) { reject(error); }
                });
            });
            closed = new Promise(resolve => request.once('close', resolve));
            request.once('error', reject);
        });
    } catch (error) { failures.push(verificationError(error)); }
    clearTimeout(timer);
    try { request?.destroy(); } catch (error) { failures.push(verificationError(error)); }
    try { response?.destroy(); } catch (error) { failures.push(verificationError(error)); }
    if (closed) {
        try { await withTimeout(closed, 'Live HTML HTTP transport closure', 5000); }
        catch (error) { failures.push(verificationError(error)); }
    }
    if (failures.length) throw new AggregateError(failures, failures[0].message, { cause: failures[0] });
    return config;
}

module.exports = { readLiveHtmlPage };
