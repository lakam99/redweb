const HtmxRenderer = require('./HtmxRenderer');
const { forEachState, getActionImplementation, getStateConfig } = require('./metadata');

const RUNTIME = new WeakMap();
const RUNTIME_METHODS = Object.freeze([
    '_activateState',
    '_attach',
    '_detach',
    '_stateChanged',
    '_setFromClient',
    '_invoke',
    'dispose',
]);

function initializeRuntime(page) {
    if (RUNTIME.has(page)) return;
    RUNTIME.set(page, {
        connections: new Set(),
        disposed: false,
        stateActive: false,
        stateValues: new Map(),
        disposePromise: null,
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
        return true;
    }

    _attach(socket, context) {
        const internal = runtime(this);
        if (internal.disposed) throw new Error('Cannot connect a disposed page.');
        internal.connections.add(socket);
        forEachState(this.constructor, (_options, name) => {
            socket.sendEvent?.('redweb:state', HtmxRenderer.statePayload(name, this[name]));
        });
        return this.connected?.(context);
    }

    async _detach(socket, context) {
        const removed = runtime(this).connections.delete(socket);
        if (removed) await this.disconnected?.(context);
        return removed;
    }

    _stateChanged(name, value) {
        if (!getStateConfig(this.constructor, name)) return false;
        const payload = HtmxRenderer.statePayload(name, value);
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
        internal.disposePromise = Promise.resolve().then(() => this.disposed?.()).then(() => true);
        return internal.disposePromise;
    }
}

module.exports = LivePage;
