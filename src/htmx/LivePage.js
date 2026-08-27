const HtmxRenderer = require('./HtmxRenderer');
const { forEachState, getActionImplementation, getStateConfig } = require('./metadata');

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
    if (Object.prototype.hasOwnProperty.call(page, '_connections')) return;
    Object.assign(page, {
        _connections: new Set(),
        _disposed: false,
        _stateActive: false,
        _stateValues: new Map(),
        _disposePromise: null,
    });
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

    _activateState() {
        if (this._stateActive) return false;
        forEachState(this.constructor, (_options, name) => {
            this._stateValues.set(name, this[name]);
            Object.defineProperty(this, name, {
                configurable: true,
                enumerable: true,
                get: () => this._stateValues.get(name),
                set: value => {
                    const previous = this._stateValues.get(name);
                    this._stateValues.set(name, value);
                    if (previous !== value) this._stateChanged(name, value);
                },
            });
        });
        this._stateActive = true;
        return true;
    }

    _attach(socket, context) {
        if (this._disposed) throw new Error('Cannot connect a disposed page.');
        this._connections.add(socket);
        forEachState(this.constructor, (_options, name) => {
            socket.sendEvent?.('redweb:state', HtmxRenderer.statePayload(name, this[name]));
        });
        return this.connected?.(context);
    }

    async _detach(socket, context) {
        const removed = this._connections.delete(socket);
        if (removed) await this.disconnected?.(context);
        return removed;
    }

    _stateChanged(name, value) {
        if (!getStateConfig(this.constructor, name)) return false;
        const payload = HtmxRenderer.statePayload(name, value);
        this._connections.forEach(socket => socket.sendEvent?.('redweb:state', payload));
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
        if (this._disposePromise) return this._disposePromise;
        this._disposed = true;
        this._connections.clear();
        this._disposePromise = Promise.resolve().then(() => this.disposed?.()).then(() => true);
        return this._disposePromise;
    }
}

module.exports = LivePage;
