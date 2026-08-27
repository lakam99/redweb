const HtmxRenderer = require('./HtmxRenderer');
const { getActionMetadata, getStateMetadata } = require('./metadata');

class LivePage {
    constructor() {
        this._connections = new Set();
        this._disposed = false;
    }

    _attach(socket, context) {
        if (this._disposed) throw new Error('Cannot connect a disposed page.');
        this._connections.add(socket);
        return this.connected?.(context);
    }

    _detach(socket, context) {
        const removed = this._connections.delete(socket);
        if (removed) this.disconnected?.(context);
        return removed;
    }

    _stateChanged(name, value) {
        if (!getStateMetadata(this.constructor).has(name)) return false;
        const payload = HtmxRenderer.statePayload(name, value);
        this._connections.forEach(socket => socket.sendEvent?.('redweb:state', payload));
        return true;
    }

    _setFromClient(name, value) {
        const config = getStateMetadata(this.constructor).get(name);
        if (!config?.writable) throw new Error(`State "${name}" is not browser-writable.`);
        this[name] = value;
    }

    async _invoke(name, args, context) {
        if (!getActionMetadata(this.constructor).has(name)) throw new Error(`Unknown page action "${name}".`);
        if (!Array.isArray(args)) throw new TypeError('Action arguments must be an array.');
        return this[name](...args, context);
    }

    dispose() {
        if (this._disposed) return false;
        this._disposed = true;
        this._connections.clear();
        this.disposed?.();
        return true;
    }
}

module.exports = LivePage;
