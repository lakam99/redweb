'use strict';

function sameOrigin(request, origin, trustProxy = false) {
    if (typeof origin !== 'string' || typeof request?.headers?.host !== 'string') return false;
    try {
        const parsed = new URL(origin);
        const forwarded = trustProxy && request.headers['x-forwarded-proto'];
        const scheme = typeof forwarded === 'string' ? forwarded.split(',')[0].trim().toLowerCase() :
            request.protocol || (request.socket?.encrypted ? 'https' : 'http');
        return (scheme === 'http' || scheme === 'https') && parsed.protocol === `${scheme}:` &&
            parsed.host.toLowerCase() === request.headers.host.toLowerCase() &&
            !parsed.username && !parsed.password && parsed.pathname === '/' && !parsed.search && !parsed.hash;
    } catch { return false; }
}

module.exports = { sameOrigin };
