'use strict';

const { isIP } = require('net');

function loopback(address) {
    if (typeof address !== 'string') return false;
    if (address === '::1') return true;
    const ipv4 = address.startsWith('::ffff:') ? address.slice(7) : address;
    return isIP(ipv4) === 4 && ipv4.startsWith('127.');
}

function loopbackRequest(request) {
    if (!loopback(request.socket?.remoteAddress)) return false;
    const host = request.headers?.host;
    if (typeof host !== 'string') return false;
    const match = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(?::(\d+))?$/i.exec(host);
    if (!match || (match[1].startsWith('127.') && !loopback(match[1]))) return false;
    const secure = Boolean(request.socket.encrypted);
    const defaultPort = secure ? 443 : 80;
    const port = match[2] === undefined ? defaultPort : Number(match[2]);
    if (port !== request.socket.localPort) return false;
    const origin = `${secure ? 'https' : 'http'}://${match[1].toLowerCase()}${port === defaultPort ? '' : `:${port}`}`;
    if (request.headers.origin !== undefined && request.headers.origin !== origin) return false;
    return request.headers['sec-fetch-site'] === undefined || ['same-origin', 'none'].includes(request.headers['sec-fetch-site']);
}

module.exports = loopbackRequest;
