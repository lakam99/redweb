'use strict';

/** Read a data descriptor, never an application accessor. Not a Proxy sandbox. */
function dataProperty(object, name) {
    for (let current = object; current && (typeof current === 'object' || typeof current === 'function'); current = Object.getPrototypeOf(current)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, name);
        if (descriptor) return Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : undefined;
    }
}

module.exports = dataProperty;
