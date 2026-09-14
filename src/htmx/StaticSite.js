const fs = require('fs');
const os = require('os');
const path = require('path');
const { decoratorDirectory } = require('./sourceRoot');
const { getPageTemplateRoot, page, pageCache, pageHead, setPageStylesheetRoots } = require('./metadata');
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

function publicFiles(publicDir) {
    if (publicDir === undefined) return [];
    const source = path.resolve(publicDir);
    const files = [];
    const visit = (directory, relative = '') => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const entryPath = path.join(directory, entry.name);
            const entryRelative = path.join(relative, entry.name);
            if (entry.isSymbolicLink()) throw new TypeError(`Site publicDir cannot contain links: ${entryPath}`);
            if (entry.isDirectory()) {
                visit(entryPath, entryRelative);
                continue;
            }
            /* istanbul ignore else -- Windows cannot create a directory-contained special file for this guard. */
            if (entry.isFile()) {
                files.push({ source: entryPath, relative: entryRelative });
                continue;
            }
            /* istanbul ignore next */
            throw new TypeError(`Site publicDir can contain only files and directories: ${entryPath}`);
        }
    };
    const details = fs.lstatSync(source);
    if (details.isSymbolicLink() || !details.isDirectory()) throw new TypeError('Site publicDir must be a directory, not a link.');
    visit(source);
    return files;
}

function outputKey(file) {
    return file.replaceAll('\\', '/').toLowerCase();
}

function rejectCollisions(files, occupied = []) {
    const seen = new Set(occupied.map(outputKey));
    for (const file of files) {
        const key = outputKey(file);
        if (seen.has(key)) throw new TypeError(`Site output paths collide: ${file}`);
        seen.add(key);
    }
}

function rejectOutputLinks(outDir) {
    if (!fs.existsSync(outDir)) return;
    const visit = directory => {
        const details = fs.lstatSync(directory);
        if (details.isSymbolicLink()) throw new TypeError(`Site outDir cannot contain links: ${directory}`);
        if (!details.isDirectory()) return;
        for (const name of fs.readdirSync(directory)) visit(path.join(directory, name));
    };
    visit(outDir);
}

function merge(directory, outDir) {
    rejectOutputLinks(outDir);
    for (const entry of publicFiles(directory)) {
        const destination = path.join(outDir, entry.relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(entry.source, destination);
    }
}

function defineSite(options = {}) {
    const siteRoot = decoratorDirectory();
    plainObject(options, 'Site options');
    const allowed = new Set(['origin', 'css', 'head', 'cache', 'layout']);
    const unknown = Object.keys(options).find(name => !allowed.has(name));
    if (unknown) throw new TypeError(`Unknown site option: ${unknown}.`);
    const origin = siteOrigin(options.origin);
    const sharedCss = files(options.css, 'Site css');
    const defaultHead = options.head === undefined ? {} : Object.freeze({ ...plainObject(options.head, 'Site head') });
    const defaultCache = pageCache(options.cache, false);
    const defaultLayout = options.layout;
    if (defaultLayout !== undefined && typeof defaultLayout !== 'function') throw new TypeError('Site layout must be a function.');
    pageHead(resolveHead(origin, '/', defaultHead));

    const decorate = (route, pageOptions = {}) => {
        plainObject(pageOptions, 'Site page options');
        if (pageOptions.live !== undefined && pageOptions.live !== false) {
            throw new TypeError('Site pages must use live: false.');
        }
        if (pageOptions.head !== undefined) plainObject(pageOptions.head, 'Page head');
        const css = [...new Set([...sharedCss, ...files(pageOptions.css, 'Page css')])];
        const decorator = page(route, {
            ...pageOptions,
            live: false,
            ...(css.length && { css }),
            head: resolveHead(origin, route, defaultHead, pageOptions.head),
            cache: pageOptions.cache === undefined ? defaultCache : pageOptions.cache,
            layout: pageOptions.layout === undefined ? defaultLayout : pageOptions.layout,
        });
        return PageClass => {
            decorator(PageClass);
            const pageRoot = getPageTemplateRoot(PageClass);
            const shared = new Set(sharedCss);
            setPageStylesheetRoots(PageClass, css.map(file => shared.has(file) ? siteRoot : pageRoot));
            return PageClass;
        };
    };

    const exportSite = async (pageOrPages, exportOptions = {}) => {
        plainObject(exportOptions, 'Site export options');
        const { publicDir, ...staticOptions } = exportOptions;
        if (typeof staticOptions.outDir !== 'string' || !staticOptions.outDir) {
            throw new TypeError('Site export requires a non-empty outDir.');
        }
        if (publicDir !== undefined && (typeof publicDir !== 'string' || !publicDir)) {
            throw new TypeError('Site publicDir must be a non-empty path.');
        }
        const outDir = path.resolve(staticOptions.outDir);
        const source = publicDir === undefined ? undefined : path.resolve(publicDir);
        if (source && (source === outDir || outDir.startsWith(`${source}${path.sep}`))) {
            throw new TypeError('Site outDir cannot be the publicDir or one of its descendants.');
        }
        const plannedPublic = publicFiles(publicDir);
        rejectCollisions(plannedPublic.map(entry => entry.relative));
        const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-site-'));
        try {
            for (const entry of plannedPublic) {
                const destination = path.join(staging, entry.relative);
                fs.mkdirSync(path.dirname(destination), { recursive: true });
                fs.copyFileSync(entry.source, destination);
            }
            const staged = await exportStatic(pageOrPages, { ...staticOptions, outDir: staging });
            const generated = [...staged.pages, ...staged.assets].map(file => path.relative(staging, file));
            rejectCollisions(plannedPublic.map(entry => entry.relative), generated);
            merge(staging, outDir);
            const destination = file => path.join(outDir, path.relative(staging, file));
            const publicAssets = plannedPublic.map(entry => path.join(outDir, entry.relative));
            return Object.freeze({
                pages: Object.freeze(staged.pages.map(destination)),
                assets: Object.freeze([...new Set([...staged.assets.map(destination), ...publicAssets])]),
            });
        } finally {
            fs.rmSync(staging, { recursive: true, force: true });
        }
    };

    return Object.freeze({ page: decorate, export: exportSite });
}

module.exports = { defineSite };
