const HtmlRenderer = require('./HtmlRenderer');
const { escapeHtml, isHtml, markHtml } = require('./Html');
const { forEachState, getActionImplementation, getStateConfig, isComponentClass } = require('./metadata');

const RUNTIME = new WeakMap();
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
        renderContext: undefined,
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

    static adoptComponent(owner, name, value) {
        if (!value || typeof value !== 'object' || !isComponentClass(value.constructor)) return null;
        if (!/^[A-Za-z_$][\w$-]{0,127}$/.test(name) || ['__proto__', 'prototype', 'constructor'].includes(name)) {
            throw new TypeError(`Component field "${name}" must be a safe identifier of at most 128 characters.`);
        }
        const parent = runtime(owner);
        const component = LivePage.adopt(value);
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
        component._activateState();
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
                    if (previous !== value) this._stateChanged(name, value);
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
        const source = this.render?.(internal.renderContext);
        if (source && typeof source.then === 'function') throw new TypeError('Component render() must be synchronous.');
        if (source === undefined) throw new Error(`${this.constructor.name || 'Component'} must provide render().`);
        const markup = isHtml(source) ? source.toString() : HtmlRenderer.render(source.toString(), this);
        return `<rw-component data-rw-component="${escapeHtml(internal.componentId)}" style="display:contents">${markup}</rw-component>`;
    }

    _component(id) {
        return runtime(this).root === this ? runtime(this).components.get(id) : undefined;
    }

    async _loadComponents(context) {
        for (const component of runtime(this).children.values()) {
            runtime(component).renderContext = context;
            await component.loading?.(context);
            await component._loadComponents(context);
        }
    }

    _attach(socket, context) {
        const internal = runtime(this);
        if (internal.disposed) throw new Error('Cannot connect a disposed page.');
        internal.connections.add(socket);
        forEachState(this.constructor, (_options, name) => {
            const payload = HtmlRenderer.statePayload(name, this[name], this);
            if (internal.componentId) payload.component = internal.componentId;
            socket.sendEvent?.('redweb:state', payload);
        });
        const connected = this.connected?.(context);
        return Promise.resolve(connected).then(async result => {
            for (const component of internal.children.values()) {
                await component._attach(socket, context);
            }
            return result;
        });
    }

    async _detach(socket, context) {
        const internal = runtime(this);
        for (const component of [...internal.children.values()].reverse()) {
            await component._detach(socket, context);
        }
        const removed = internal.connections.delete(socket);
        if (removed) await this.disconnected?.(context);
        return removed;
    }

    _stateChanged(name, value) {
        if (!getStateConfig(this.constructor, name)) return false;
        const payload = HtmlRenderer.statePayload(name, value, this);
        if (runtime(this).componentId) payload.component = runtime(this).componentId;
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
            const failures = [];
            for (const component of internal.children.values()) {
                try { await component.dispose(); }
                catch (error) { failures.push(error); }
            }
            try { await this.disposed?.(); }
            catch (error) { failures.push(error); }
            if (failures.length === 1) throw failures[0];
            if (failures.length > 1) throw new AggregateError(failures, 'Live HTML component cleanup failed.');
            return true;
        });
        return internal.disposePromise;
    }
}

module.exports = LivePage;
