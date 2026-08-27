const PAGE_METADATA = new WeakMap();
const STATE_METADATA = new WeakMap();
const ACTION_METADATA = new WeakMap();

function assertDecoratorTarget(target, label) {
    if (!target || typeof target !== 'object' || typeof target.constructor !== 'function') {
        throw new TypeError(`${label} must decorate a class member.`);
    }
    return target.constructor;
}

function page(routePath, options = {}) {
    if (typeof routePath !== 'string' || !routePath.startsWith('/')) {
        throw new TypeError('A page path beginning with "/" is required.');
    }
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError('Page options must be an object.');
    }
    const { template, scope = 'connection' } = options;
    if (template !== undefined && (typeof template !== 'string' || !template)) {
        throw new TypeError('Page template must be a non-empty path.');
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
    return (target, property) => {
        const PageClass = assertDecoratorTarget(target, 'state()');
        if (typeof property !== 'string' || !property) throw new TypeError('State property must be a non-empty string.');
        const properties = new Map(STATE_METADATA.get(PageClass) || []);
        properties.set(property, Object.freeze({ writable }));
        STATE_METADATA.set(PageClass, properties);

        const values = new WeakMap();
        Object.defineProperty(target, property, {
            configurable: true,
            enumerable: true,
            get() { return values.get(this); },
            set(value) {
                const previous = values.get(this);
                values.set(this, value);
                if (previous !== value) this._stateChanged?.(property, value);
            },
        });
    };
}

function action() {
    return (target, method, descriptor) => {
        const PageClass = assertDecoratorTarget(target, 'action()');
        if (typeof method !== 'string' || !method || typeof descriptor?.value !== 'function') {
            throw new TypeError('action() must decorate a method.');
        }
        const methods = new Set(ACTION_METADATA.get(PageClass) || []);
        methods.add(method);
        ACTION_METADATA.set(PageClass, methods);
        return descriptor;
    };
}

function getPageMetadata(PageClass) {
    return PAGE_METADATA.get(PageClass);
}

function getStateMetadata(PageClass) {
    return new Map(STATE_METADATA.get(PageClass) || []);
}

function getActionMetadata(PageClass) {
    return new Set(ACTION_METADATA.get(PageClass) || []);
}

module.exports = { action, getActionMetadata, getPageMetadata, getStateMetadata, page, state };
