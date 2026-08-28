const { AsyncLocalStorage } = require('async_hooks');
const HtmlRenderer = require('./HtmlRenderer');
const TemplateRenderer = require('./TemplateRenderer');
const { isHtml, markHtml, renderValue } = require('./Html');
const { forEachState, getActionImplementation, getStateConfig, isComponentClass } = require('./metadata');

const RUNTIME = new WeakMap();
const COMPONENT_RENDER_CONTEXT = new AsyncLocalStorage();
const RUNTIME_METHODS = Object.freeze([
    '_activateState',
    '_component',
    '_loadComponents',
    '_attach',
    '_detach',
    '_stateChanged',
    '_setFromClient',
    '_invoke',
    'dispose',
]);

function initializeRuntime(page) {
    RUNTIME.set(page, {
        connections: new Set(),
        disposed: false,
        stateActive: false,
        stateValues: new Map(),
        disposePromise: null,
        children: new Map(),
        componentId: null,
        components: new Map(),
        root: page,
    });
}

function runtime(page) {
    return RUNTIME.get(page);
}

class LivePage {
    constructor() {
        initializeRuntime(this);
    }

    static adopt(page) {
        if (!page || typeof page !== 'object') throw new TypeError('Page construction must return an object.');
        if (RUNTIME.has(page)) return page;
        if (!(page instanceof LivePage)) {
            RUNTIME_METHODS.forEach(name => {
                if (name in page) throw new TypeError(`Plain page classes cannot define reserved member "${name}".`);
                Object.defineProperty(page, name, {
                    configurable: false,
                    enumerable: false,
                    writable: false,
                    value: LivePage.prototype[name],
                });
            });
        }
        initializeRuntime(page);
        return page;
    }

    static isDisposed(page) {
        return runtime(page).disposed;
    }

    static activate(page) { return LivePage.prototype._activateState.call(page); }
    static attach(page, socket, context) { return LivePage.prototype._attach.call(page, socket, context); }
    static detach(page, socket, context) { return LivePage.prototype._detach.call(page, socket, context); }
    static dispose(page) { return LivePage.prototype.dispose.call(page); }
    static invoke(page, name, args, context) { return LivePage.prototype._invoke.call(page, name, args, context); }
    static loadComponents(page, context) { return LivePage.prototype._loadComponents.call(page, context); }
    static setFromClient(page, name, value) { return LivePage.prototype._setFromClient.call(page, name, value); }

    static statePayload(page, name, value) {
        const internal = runtime(page);
        const payload = HtmlRenderer.statePayload(name, value, page);
        if (!internal.componentId) return payload;
        payload.component = internal.componentId;
        if (payload.html) payload.value = TemplateRenderer.component(payload.value, internal.componentId);
        return payload;
    }

    static withRenderContext(context, render) {
        return COMPONENT_RENDER_CONTEXT.run(context, render);
    }

    static adoptComponent(owner, name, value) {
        if (!value || typeof value !== 'object' || !isComponentClass(value.constructor)) return null;
        if (!/^[A-Za-z_$][\w$-]{0,127}$/.test(name) || ['__proto__', 'prototype', 'constructor'].includes(name)) {
            throw new TypeError(`Component field "${name}" must be a safe identifier of at most 128 characters.`);
        }
        const parent = runtime(owner);
        const component = value;
        if (!RUNTIME.has(component)) initializeRuntime(component);
        const internal = runtime(component);
        const id = parent.componentId ? `${parent.componentId}.${name}` : name;
        if (id.length > 128) throw new TypeError('Nested component identifiers must be at most 128 characters.');
        if (internal.componentId && (internal.componentId !== id || internal.root !== parent.root)) {
            throw new Error('A component instance can belong to only one component field.');
        }
        internal.componentId = id;
        internal.root = parent.root;
        parent.children.set(name, component);
        runtime(parent.root).components.set(id, component);
        if (!isHtml(component)) markHtml(component, LivePage.prototype._renderComponent);
        LivePage.activate(component);
        return component;
    }

    get _connections() { return runtime(this).connections; }
    get _disposed() { return runtime(this).disposed; }
    get _disposePromise() { return runtime(this).disposePromise; }

    _activateState() {
        const internal = runtime(this);
        if (internal.stateActive) return false;
        forEachState(this.constructor, (_options, name) => {
            internal.stateValues.set(name, this[name]);
            Object.defineProperty(this, name, {
                configurable: true,
                enumerable: true,
                get: () => internal.stateValues.get(name),
                set: value => {
                    const previous = internal.stateValues.get(name);
                    internal.stateValues.set(name, value);
                    if (previous !== value) LivePage.prototype._stateChanged.call(this, name, value);
                },
            });
        });
        internal.stateActive = true;
        Object.keys(this).forEach(name => {
            const value = this[name];
            if (isComponentClass(value?.constructor) && getStateConfig(this.constructor, name)) {
                throw new TypeError(`Component field "${name}" cannot also be decorated with state().`);
            }
            LivePage.adoptComponent(this, name, value);
        });
        return true;
    }

    _renderComponent() {
        const internal = runtime(this);
        if (!internal.componentId) throw new Error('Components must be owned by a page field before rendering.');
        const source = this.render?.(COMPONENT_RENDER_CONTEXT.getStore());
        if (source && typeof source.then === 'function') throw new TypeError('Component render() must be synchronous.');
        if (source === undefined) throw new Error(`${this.constructor.name || 'Component'} must provide render().`);
        const markup = isHtml(source) ? renderValue(source) : HtmlRenderer.render(source.toString(), this);
        return TemplateRenderer.component(markup, internal.componentId);
    }

    _component(id) {
        return runtime(this).root === this ? runtime(this).components.get(id) : undefined;
    }

    async _loadComponents(context) {
        for (const component of runtime(this).children.values()) {
            await component.loading?.(context);
            await LivePage.loadComponents(component, context);
        }
    }

    _attach(socket, context) {
        const internal = runtime(this);
        if (internal.disposed) throw new Error('Cannot connect a disposed page.');
        internal.connections.add(socket);
        forEachState(this.constructor, (_options, name) => {
            const payload = LivePage.statePayload(this, name, this[name]);
            socket.sendEvent?.('redweb:state', payload);
        });
        const connected = this.connected?.(context);
        return Promise.resolve(connected).then(async result => {
            for (const component of internal.children.values()) {
                await LivePage.attach(component, socket, context);
            }
            return result;
        });
    }

    async _detach(socket, context) {
        const internal = runtime(this);
        const removed = internal.connections.delete(socket);
        if (!removed) return false;
        const tasks = [...internal.children.values()].reverse().map(component => LivePage.detach(component, socket, context));
        tasks.push(Promise.resolve().then(() => this.disconnected?.(context)));
        const results = await Promise.allSettled(tasks);
        LivePage._throwLifecycleFailures(results, 'Live HTML component disconnect failed.');
        return true;
    }

    _stateChanged(name, value) {
        if (!getStateConfig(this.constructor, name)) return false;
        const payload = LivePage.statePayload(this, name, value);
        runtime(this).connections.forEach(socket => socket.sendEvent?.('redweb:state', payload));
        return true;
    }

    _setFromClient(name, value) {
        const config = getStateConfig(this.constructor, name);
        if (!config?.writable) throw new Error(`State "${name}" is not browser-writable.`);
        this[name] = value;
    }

    async _invoke(name, args, context) {
        const implementation = getActionImplementation(this.constructor, name);
        if (!implementation || this[name] !== implementation) throw new Error(`Unknown page action "${name}".`);
        if (!Array.isArray(args)) throw new TypeError('Action arguments must be an array.');
        return implementation.call(this, ...args, context);
    }

    async dispose() {
        const internal = runtime(this);
        if (internal.disposePromise) return internal.disposePromise;
        internal.disposed = true;
        internal.connections.clear();
        internal.disposePromise = Promise.resolve().then(async () => {
            const tasks = [...internal.children.values()].map(component => LivePage.dispose(component));
            tasks.push(Promise.resolve().then(() => this.disposed?.()));
            const results = await Promise.allSettled(tasks);
            LivePage._throwLifecycleFailures(results, 'Live HTML component cleanup failed.');
            return true;
        });
        return internal.disposePromise;
    }

    static _throwLifecycleFailures(results, message) {
        const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) throw new AggregateError(failures, message);
    }
}

module.exports = LivePage;
