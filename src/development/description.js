'use strict';

const { getActionMetadata, getStateMetadata } = require('../htmx/metadata');
const dataProperty = require('../dataProperty');
const LIMIT = 100;
const text = value => typeof value === 'string' ? value.slice(0, 128) : '[unavailable]';

function list(values, describe = text, budget) {
    const items = [];
    let total = 0;
    for (const value of values) {
        if (total++ < LIMIT && (!budget || budget.remaining > 0)) {
            if (budget) budget.remaining--;
            items.push(describe(value));
        }
    }
    return { items, total, truncated: total > items.length };
}

function members(Class, describeList = list) {
    return { className: text(dataProperty(Class, 'name')), actions: describeList(typeof Class === 'function' ? getActionMetadata(Class) : []),
        states: describeList(typeof Class === 'function' ? getStateMetadata(Class).keys() : []) };
}

const mapSize = map => Object.getOwnPropertyDescriptor(Map.prototype, 'size').get.call(map);

function freeze(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}

module.exports = { list, text, members, freeze, mapSize };
