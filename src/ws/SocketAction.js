'use strict';

// Browser-safe metadata keeps the standalone contract entry free of Node rendering dependencies.
const bindings = new WeakMap();
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
module.exports = { register, bindings };
