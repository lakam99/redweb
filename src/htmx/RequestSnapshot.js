'use strict';

/** Retain only portable request data, never an Express response/socket graph. */
function requestSnapshot(request) {
    let bytes = 0;
    const copy = (value, depth = 0) => {
        if (depth > 16) throw new TypeError('Page request data exceeds the nesting limit.');
        bytes += 8;
        if (bytes > 65536) throw new TypeError('Page request data exceeds 64 KiB.');
        if (value === undefined || value === null || typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            bytes += Buffer.byteLength(value);
            if (bytes > 65536) throw new TypeError('Page request data exceeds 64 KiB.');
            return value;
        }
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value !== 'object' || (!Array.isArray(value) && Object.getPrototypeOf(value) !== null && Object.getPrototypeOf(Object.getPrototypeOf(value)) !== null)) {
            throw new TypeError('Page request data must contain only JSON-compatible values.');
        }
        if (Array.isArray(value)) {
            if (value.length > 8192) throw new TypeError('Page request data exceeds 64 KiB.');
            return Object.freeze(value.map(item => copy(item, depth + 1)));
        }
        return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [copy(key, depth + 1), copy(item, depth + 1)])));
    };
    const data = copy({
        path: request.path || '/', url: request.url || '/', method: request.method || 'GET',
        headers: request.headers || {}, params: request.params || {}, query: request.query || {}, body: request.body,
    });
    return Object.freeze({ ...data, get(name) {
        const value = Object.hasOwn(data.headers, name.toLowerCase()) ? data.headers[name.toLowerCase()] : undefined;
        return Array.isArray(value) ? value.join(', ') : value;
    } });
}

module.exports = requestSnapshot;
