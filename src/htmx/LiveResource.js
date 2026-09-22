'use strict';

const PAGE_BINDINGS = new WeakMap();
const UNBOUND = Symbol('unbound');

function key(value) {
    if (value === undefined || value === null) return UNBOUND;
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'bigint' || typeof value === 'boolean') return value;
    throw new TypeError('Live resource keys must be non-empty strings, finite numbers, bigints, booleans, null, or undefined.');
}

function safeProperty(value) {
    if (typeof value !== 'string' || !value || value.length > 128 || ['__proto__', 'prototype', 'constructor'].includes(value)) {
        throw new TypeError('Live resource properties must be safe non-empty names of at most 128 characters.');
    }
    return value;
}

class LiveResource {
    constructor() {
        this.subscribers = new Map();
    }

    publish(resourceKey, value) {
        const resolved = key(resourceKey);
        if (resolved === UNBOUND) throw new TypeError('Live resources cannot publish without a key.');
        const subscribers = [...(this.subscribers.get(resolved) || [])];
        subscribers.forEach(binding => {
            if (!binding.active || binding.key !== resolved) return;
            binding.page[binding.property] = value;
        });
        return subscribers.length;
    }

    bind(page, property, select) {
        if (!page || typeof page !== 'object') throw new TypeError('Live resources bind to page instances.');
        safeProperty(property);
        if (typeof select !== 'function') throw new TypeError('Live resources require a key selector.');
        const binding = { resource: this, page, property, select, key: UNBOUND, active: true };
        const bindings = PAGE_BINDINGS.get(page) || new Set();
        bindings.add(binding);
        PAGE_BINDINGS.set(page, bindings);
        this.refresh(binding);
        return binding;
    }

    refresh(binding) {
        if (!binding.active) return false;
        const next = key(binding.select(binding.page));
        if (Object.is(next, binding.key)) return false;
        if (binding.key !== UNBOUND) this.subscribers.get(binding.key)?.delete(binding);
        binding.key = next;
        if (next !== UNBOUND) {
            const subscribers = this.subscribers.get(next) || new Set();
            subscribers.add(binding);
            this.subscribers.set(next, subscribers);
        }
        return true;
    }

    release(binding) {
        if (!binding?.active) return false;
        binding.active = false;
        if (binding.key !== UNBOUND) {
            const subscribers = this.subscribers.get(binding.key);
            subscribers?.delete(binding);
            if (subscribers?.size === 0) this.subscribers.delete(binding.key);
        }
        const bindings = PAGE_BINDINGS.get(binding.page);
        bindings?.delete(binding);
        if (bindings?.size === 0) PAGE_BINDINGS.delete(binding.page);
        return true;
    }

    static refresh(page) {
        PAGE_BINDINGS.get(page)?.forEach(binding => binding.resource.refresh(binding));
    }

    static release(page) {
        [...(PAGE_BINDINGS.get(page) || [])].forEach(binding => binding.resource.release(binding));
    }
}

function liveResource() { return new LiveResource(); }

module.exports = { LiveResource, liveResource };
