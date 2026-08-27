const PAGE_METADATA = new WeakMap();
const STATE_METADATA = new WeakMap();
const ACTION_METADATA = new WeakMap();
const RESOLVED_STATE = new WeakMap();
const RESOLVED_ACTION = new WeakMap();
const STANDARD_ACTIONS = new WeakMap();
const VIEW_METADATA = new WeakMap();
const RESOLVED_VIEW = new WeakMap();
const STANDARD_VIEWS = new WeakMap();
const PAGE_ROOTS = new WeakMap();
const { decoratorDirectory } = require('./sourceRoot');
let metadataVersion = 0;

function assertDecoratorTarget(target, label) {
    if (!target || typeof target !== 'object' || typeof target.constructor !== 'function') {
        throw new TypeError(`${label} must decorate a class member.`);
    }
    return target.constructor;
}

function hierarchy(PageClass) {
    const classes = [];
    for (let current = PageClass; typeof current === 'function' && current !== Function.prototype; current = Object.getPrototypeOf(current)) {
        classes.unshift(current);
    }
    return classes;
}

function registerState(PageClass, property, config) {
    const properties = new Map(STATE_METADATA.get(PageClass) || []);
    const existing = properties.get(property);
    if (existing?.writable === config.writable) return;
    properties.set(property, config);
    STATE_METADATA.set(PageClass, properties);
    metadataVersion += 1;
}

function registerAction(PageClass, method, implementation) {
    const methods = new Map(ACTION_METADATA.get(PageClass) || []);
    if (methods.get(method) === implementation) return;
    methods.set(method, implementation);
    ACTION_METADATA.set(PageClass, methods);
    metadataVersion += 1;
}

function registerStandardAction(PageClass, method, implementation) {
    const methods = new Map(STANDARD_ACTIONS.get(PageClass) || []);
    if (methods.get(method) === implementation) return;
    methods.set(method, implementation);
    STANDARD_ACTIONS.set(PageClass, methods);
    metadataVersion += 1;
}

function registerView(store, PageClass, stateName, method, implementation) {
    const views = new Map(store.get(PageClass) || []);
    const existing = views.get(stateName);
    if (existing?.method === method && existing.implementation === implementation) return;
    views.set(stateName, Object.freeze({ method, implementation }));
    store.set(PageClass, views);
    metadataVersion += 1;
}

function resolvedState(PageClass) {
    const cached = RESOLVED_STATE.get(PageClass);
    if (cached?.version === metadataVersion) return cached.value;
    const value = new Map();
    hierarchy(PageClass).forEach(CurrentClass => {
        STATE_METADATA.get(CurrentClass)?.forEach((config, property) => value.set(property, config));
    });
    RESOLVED_STATE.set(PageClass, { version: metadataVersion, value });
    return value;
}

function resolvedAction(PageClass) {
    const cached = RESOLVED_ACTION.get(PageClass);
    if (cached?.version === metadataVersion) return cached.value;
    const value = new Map();
    hierarchy(PageClass).forEach(CurrentClass => {
        const own = new Map(ACTION_METADATA.get(CurrentClass) || []);
        STANDARD_ACTIONS.get(CurrentClass)?.forEach((implementation, method) => {
            if (CurrentClass.prototype[method] === implementation) own.set(method, implementation);
        });
        value.forEach((_implementation, method) => {
            if (Object.prototype.hasOwnProperty.call(CurrentClass.prototype, method) && !own.has(method)) value.delete(method);
        });
        own.forEach((implementation, method) => value.set(method, implementation));
    });
    RESOLVED_ACTION.set(PageClass, { version: metadataVersion, value });
    return value;
}

function resolvedView(PageClass) {
    const cached = RESOLVED_VIEW.get(PageClass);
    if (cached?.version === metadataVersion) return cached.value;
    const value = new Map();
    hierarchy(PageClass).forEach(CurrentClass => {
        const own = new Map(VIEW_METADATA.get(CurrentClass) || []);
        STANDARD_VIEWS.get(CurrentClass)?.forEach((entry, stateName) => {
            if (CurrentClass.prototype[entry.method] === entry.implementation) own.set(stateName, entry);
        });
        value.forEach((entry, stateName) => {
            if (Object.prototype.hasOwnProperty.call(CurrentClass.prototype, entry.method) && !own.has(stateName)) value.delete(stateName);
        });
        own.forEach((entry, stateName) => value.set(stateName, entry));
    });
    RESOLVED_VIEW.set(PageClass, { version: metadataVersion, value });
    return value;
}

function pageHead(value) {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Page head must be an object.');
    const allowed = new Set(['title', 'description', 'canonical', 'image', 'robots']);
    const unknown = Object.keys(value).find(name => !allowed.has(name));
    if (unknown) throw new TypeError(`Unknown page head option: ${unknown}.`);
    const head = {};
    for (const name of ['title', 'description', 'robots']) {
        if (value[name] !== undefined && (typeof value[name] !== 'string' || !value[name])) {
            throw new TypeError(`Page head ${name} must be a non-empty string.`);
        }
        if (value[name] !== undefined) head[name] = value[name];
    }
    for (const name of ['canonical', 'image']) {
        if (value[name] === undefined) continue;
        if (typeof value[name] !== 'string' || !value[name]) throw new TypeError(`Page head ${name} must be an absolute HTTP(S) URL.`);
        let parsed;
        try { parsed = new URL(value[name]); }
        catch { throw new TypeError(`Page head ${name} must be an absolute HTTP(S) URL.`); }
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new TypeError(`Page head ${name} must be an absolute HTTP(S) URL.`);
        head[name] = parsed.href;
    }
    return Object.freeze(head);
}

function pageCache(value, live) {
    if (value === undefined) return undefined;
    if (live) throw new TypeError('Page cache is available only when live is false.');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Page cache must be an object.');
    const allowed = new Set(['maxAge', 'staleWhileRevalidate', 'immutable']);
    const unknown = Object.keys(value).find(name => !allowed.has(name));
    if (unknown) throw new TypeError(`Unknown page cache option: ${unknown}.`);
    const { maxAge = 0, staleWhileRevalidate = 0, immutable = false } = value;
    if (!Number.isInteger(maxAge) || maxAge < 0) throw new TypeError('Page cache maxAge must be a non-negative integer.');
    if (!Number.isInteger(staleWhileRevalidate) || staleWhileRevalidate < 0) {
        throw new TypeError('Page cache staleWhileRevalidate must be a non-negative integer.');
    }
    if (typeof immutable !== 'boolean') throw new TypeError('Page cache immutable must be a boolean.');
    return Object.freeze({ maxAge, staleWhileRevalidate, immutable });
}

function page(routePath, options = {}) {
    const templateRoot = decoratorDirectory();
    if (typeof routePath !== 'string' || !routePath.startsWith('/')) {
        throw new TypeError('A page path beginning with "/" is required.');
    }
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError('Page options must be an object.');
    }
    const { template, css, shared, scope = shared ? 'shared' : 'connection', live = true } = options;
    if (template !== undefined && (typeof template !== 'string' || !template)) {
        throw new TypeError('Page template must be a non-empty path.');
    }
    const stylesheets = css === undefined ? undefined : [...new Set(Array.isArray(css) ? css : [css])];
    if (stylesheets && (stylesheets.length === 0 || stylesheets.some(file => typeof file !== 'string' || !file))) {
        throw new TypeError('Page css must be a non-empty path or array of non-empty paths.');
    }
    if (shared !== undefined && typeof shared !== 'boolean') {
        throw new TypeError('Page shared must be a boolean.');
    }
    if (shared !== undefined && options.scope !== undefined && (scope === 'shared') !== shared) {
        throw new TypeError('Page scope and shared options conflict.');
    }
    if (!['connection', 'shared'].includes(scope)) {
        throw new TypeError('Page scope must be "connection" or "shared".');
    }
    if (typeof live !== 'boolean') throw new TypeError('Page live must be a boolean.');
    const head = pageHead(options.head);
    const cache = pageCache(options.cache, live);
    return PageClass => {
        if (typeof PageClass !== 'function') throw new TypeError('page() must decorate a class.');
        PAGE_METADATA.set(PageClass, Object.freeze({
            path: routePath,
            template,
            scope,
            ...(live === false && { live: false }),
            ...(head && { head }),
            ...(cache && { cache }),
            ...(stylesheets && { css: Object.freeze(stylesheets) }),
        }));
        PAGE_ROOTS.set(PageClass, templateRoot);
        return PageClass;
    };
}

function state(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError('State options must be an object.');
    }
    const { writable = false } = options;
    if (typeof writable !== 'boolean') throw new TypeError('State writable must be a boolean.');
    const config = Object.freeze({ writable });
    return (target, property) => {
        if (property?.kind === 'field') {
            if (property.static || property.private || typeof property.name !== 'string' || !property.name) {
                throw new TypeError('state() requires a public instance field with a string name.');
            }
            property.addInitializer(function registerStandardState() {
                registerState(this.constructor, property.name, config);
            });
            return initialValue => initialValue;
        }
        const PageClass = assertDecoratorTarget(target, 'state()');
        if (typeof property !== 'string' || !property) throw new TypeError('State property must be a non-empty string.');
        registerState(PageClass, property, config);
    };
}

function action() {
    return (target, method, descriptor) => {
        if (method?.kind === 'method') {
            if (method.static || method.private || typeof method.name !== 'string' || !method.name || typeof target !== 'function') {
                throw new TypeError('action() requires a public instance method with a string name.');
            }
            method.addInitializer(function registerStandardActionInitializer() {
                if (this[method.name] === target) registerStandardAction(this.constructor, method.name, target);
            });
            return target;
        }
        const PageClass = assertDecoratorTarget(target, 'action()');
        if (typeof method !== 'string' || !method || typeof descriptor?.value !== 'function') {
            throw new TypeError('action() must decorate a method.');
        }
        registerAction(PageClass, method, descriptor.value);
        return descriptor;
    };
}

function view(stateName) {
    if (typeof stateName !== 'string' || !stateName) throw new TypeError('view() requires a non-empty state name.');
    return (target, method, descriptor) => {
        if (method?.kind === 'method') {
            if (method.static || method.private || typeof method.name !== 'string' || !method.name || typeof target !== 'function') {
                throw new TypeError('view() requires a public instance method with a string name.');
            }
            method.addInitializer(function registerStandardViewInitializer() {
                if (this[method.name] === target) registerView(STANDARD_VIEWS, this.constructor, stateName, method.name, target);
            });
            return target;
        }
        const PageClass = assertDecoratorTarget(target, 'view()');
        if (typeof method !== 'string' || !method || typeof descriptor?.value !== 'function') {
            throw new TypeError('view() must decorate a method.');
        }
        registerView(VIEW_METADATA, PageClass, stateName, method, descriptor.value);
        return descriptor;
    };
}

function getPageMetadata(PageClass) {
    return PAGE_METADATA.get(PageClass);
}

function getPageTemplateRoot(PageClass) {
    return PAGE_ROOTS.get(PageClass);
}

function getStateMetadata(PageClass) {
    return new Map(resolvedState(PageClass));
}

function getActionMetadata(PageClass) {
    return new Set(resolvedAction(PageClass).keys());
}

function getStateConfig(PageClass, property) {
    return resolvedState(PageClass).get(property);
}

function forEachState(PageClass, callback) {
    resolvedState(PageClass).forEach(callback);
}

function getActionImplementation(PageClass, method) {
    return resolvedAction(PageClass).get(method);
}

function getViewImplementation(PageClass, stateName) {
    return getViewMetadata(PageClass, stateName)?.implementation;
}

function getViewMetadata(PageClass, stateName) {
    return resolvedView(PageClass).get(stateName);
}

module.exports = {
    action,
    forEachState,
    getActionImplementation,
    getActionMetadata,
    getPageMetadata,
    getPageTemplateRoot,
    getStateConfig,
    getStateMetadata,
    getViewImplementation,
    getViewMetadata,
    page,
    state,
    view,
};
