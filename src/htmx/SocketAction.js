'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const { bindings } = require('../ws/SocketAction');
const routes = new AsyncLocalStorage();

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

module.exports = { attributes, withRoute: (handlers, render) => routes.run(handlers, render) };
