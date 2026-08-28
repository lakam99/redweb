const fs = require('fs');
const path = require('path');
const { page } = require('./metadata');
const { exportStatic } = require('./StaticExporter');

function plainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
    return value;
}

function files(value, label) {
    if (value === undefined) return [];
    const result = Array.isArray(value) ? value : [value];
    if (!result.length || result.some(file => typeof file !== 'string' || !file)) {
        throw new TypeError(`${label} must be a non-empty path or array of non-empty paths.`);
    }
    return result;
}

function siteOrigin(value) {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !value) throw new TypeError('Site origin must be an absolute HTTP(S) origin.');
    let parsed;
    try { parsed = new URL(value); }
    catch { throw new TypeError('Site origin must be an absolute HTTP(S) origin.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
        parsed.pathname !== '/' || parsed.search || parsed.hash) {
        throw new TypeError('Site origin must be an absolute HTTP(S) origin.');
    }
    return parsed.origin;
}

function resolveHead(origin, route, defaults, overrides) {
    const head = { ...defaults, ...overrides };
    if (origin && head.canonical === undefined) head.canonical = new URL(route, `${origin}/`).href;
    if (origin && typeof head.image === 'string' && head.image.startsWith('/')) head.image = new URL(head.image, `${origin}/`).href;
    return Object.keys(head).length ? head : undefined;
}

function copyPublic(publicDir, outDir) {
    if (publicDir === undefined) return;
    if (typeof publicDir !== 'string' || !publicDir) throw new TypeError('Site publicDir must be a non-empty path.');
    const source = path.resolve(publicDir);
    const destination = path.resolve(outDir);
    if (source === destination || destination.startsWith(`${source}${path.sep}`)) {
        throw new TypeError('Site outDir cannot be the publicDir or one of its descendants.');
    }
    fs.mkdirSync(destination, { recursive: true });
    fs.cpSync(source, destination, { recursive: true, force: true });
}

function defineSite(options = {}) {
    plainObject(options, 'Site options');
    const allowed = new Set(['origin', 'css', 'head', 'cache', 'layout']);
    const unknown = Object.keys(options).find(name => !allowed.has(name));
    if (unknown) throw new TypeError(`Unknown site option: ${unknown}.`);
    const origin = siteOrigin(options.origin);
    const sharedCss = files(options.css, 'Site css');
    const defaultHead = options.head === undefined ? {} : plainObject(options.head, 'Site head');
    const defaultCache = options.cache;
    const defaultLayout = options.layout;
    if (defaultLayout !== undefined && typeof defaultLayout !== 'function') throw new TypeError('Site layout must be a function.');

    const decorate = (route, pageOptions = {}) => {
        plainObject(pageOptions, 'Site page options');
        if (pageOptions.live !== undefined && pageOptions.live !== false) {
            throw new TypeError('Site pages must use live: false.');
        }
        if (pageOptions.head !== undefined) plainObject(pageOptions.head, 'Page head');
        const css = [...new Set([...sharedCss, ...files(pageOptions.css, 'Page css')])];
        return page(route, {
            ...pageOptions,
            live: false,
            ...(css.length && { css }),
            head: resolveHead(origin, route, defaultHead, pageOptions.head),
            cache: pageOptions.cache ?? defaultCache,
            layout: pageOptions.layout ?? defaultLayout,
        });
    };

    const exportSite = async (pageOrPages, exportOptions = {}) => {
        plainObject(exportOptions, 'Site export options');
        const { publicDir, ...staticOptions } = exportOptions;
        if (typeof staticOptions.outDir !== 'string' || !staticOptions.outDir) {
            throw new TypeError('Site export requires a non-empty outDir.');
        }
        copyPublic(publicDir, staticOptions.outDir);
        return exportStatic(pageOrPages, staticOptions);
    };

    return Object.freeze({ page: decorate, export: exportSite });
}

module.exports = { defineSite };
