'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const bindings = new WeakMap();
const routes = new AsyncLocalStorage();

/** Server-only identities: arbitrary objects/functions cannot become executable bindings. */
function register(Handler, type) {
    bindings.set(Handler, { Handler, type });
    Object.defineProperty(Handler, 'with', { value(payload) {
        const serialized = JSON.stringify(payload);
        if (serialized === undefined || serialized.length > 65536) throw new TypeError('Socket action payload must be bounded JSON.');
        const binding = Object.freeze({});
        bindings.set(binding, { Handler, type, payload: JSON.parse(serialized) });
        return binding;
    } });
    return Handler;
}

function attributes(properties) {
    let result = properties;
    for (const name of ['rw-click', 'rw-submit']) {
        const binding = bindings.get(properties[name]);
        if (!binding) continue;
        if (!routes.getStore()?.has(binding.Handler)) throw new TypeError('Socket action handler must belong to this page socket route.');
        if (Object.keys(result).some(key => key.toLowerCase() === 'data-rw-command')) throw new TypeError('Only one socket action may bind a control.');
        result = { ...result, [name]: binding.type, 'data-rw-command': JSON.stringify({ type: binding.type, payload: binding.payload }) };
    }
    return result;
}

module.exports = { register, attributes, withRoute: (handlers, render) => routes.run(handlers, render) };
