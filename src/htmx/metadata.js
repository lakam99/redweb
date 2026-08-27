const PAGE_METADATA = new WeakMap();
const STATE_METADATA = new WeakMap();
const ACTION_METADATA = new WeakMap();
const RESOLVED_STATE = new WeakMap();
const RESOLVED_ACTION = new WeakMap();
const STANDARD_ACTIONS = new WeakMap();
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

function page(routePath, options = {}) {
    if (typeof routePath !== 'string' || !routePath.startsWith('/')) {
        throw new TypeError('A page path beginning with "/" is required.');
    }
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError('Page options must be an object.');
    }
    const { template, shared, scope = shared ? 'shared' : 'connection' } = options;
    if (template !== undefined && (typeof template !== 'string' || !template)) {
        throw new TypeError('Page template must be a non-empty path.');
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
    return PageClass => {
        if (typeof PageClass !== 'function') throw new TypeError('page() must decorate a class.');
        PAGE_METADATA.set(PageClass, Object.freeze({ path: routePath, template, scope }));
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

function getPageMetadata(PageClass) {
    return PAGE_METADATA.get(PageClass);
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

module.exports = {
    action,
    forEachState,
    getActionImplementation,
    getActionMetadata,
    getPageMetadata,
    getStateConfig,
    getStateMetadata,
    page,
    state,
};
