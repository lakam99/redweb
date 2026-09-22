'use strict';

const { LiveResource, liveResource } = require('../../src/htmx/LiveResource');

describe('LiveResource', () => {
    test('accepts supported key types and rejects unsafe properties', () => {
        const resource = liveResource();
        expect(resource).toBeInstanceOf(LiveResource);
        const page = { key: null, value: null };
        const binding = resource.bind(page, 'value', owner => owner.key);
        expect(resource.publish(0, 'unsubscribed')).toBe(0);
        expect(() => resource.publish(null, 'unbound')).toThrow('without a key');
        expect(() => resource.publish({}, 'invalid')).toThrow('keys');
        expect(() => resource.bind(null, 'value', () => 'project')).toThrow('page instances');
        expect(() => resource.bind(page, 'value', null)).toThrow('key selector');
        for (const key of [0, 1n, true, false, 'project']) {
            page.key = key;
            LiveResource.refresh(page);
            expect(resource.publish(key, String(key))).toBe(1);
            expect(page.value).toBe(String(key));
        }
        page.key = undefined;
        LiveResource.refresh(page);
        expect(resource.subscribers.size).toBe(0);
        expect(resource.release(binding)).toBe(true);
        expect(resource.release(binding)).toBe(false);
        for (const property of [1, '__proto__', 'prototype', 'constructor', 'x'.repeat(129)]) {
            expect(() => resource.bind(page, property, () => 'project')).toThrow('properties');
        }
    });

    test('keeps the last subscriber when a peer changes keys and ignores released bindings', () => {
        const resource = liveResource();
        const first = { key: 'shared', value: null };
        const second = { key: 'shared', value: null };
        const one = resource.bind(first, 'value', owner => owner.key);
        resource.bind(second, 'value', owner => owner.key);
        expect(resource.refresh(one)).toBe(false);
        first.key = 'private';
        expect(resource.refresh(one)).toBe(true);
        expect(resource.publish('shared', 'public')).toBe(1);
        expect(first.value).toBeNull();
        expect(second.value).toBe('public');
        expect(resource.publish('private', 'secret')).toBe(1);
        expect(first.value).toBe('secret');
        LiveResource.release(first);
        expect(resource.refresh(one)).toBe(false);
        expect(resource.publish('private', 'ignored')).toBe(0);
        LiveResource.release(second);
        expect(resource.subscribers.size).toBe(0);
        LiveResource.release(second);
    });

    test('a subscriber can rekey or dispose another subscriber during publication', () => {
        const resource = liveResource();
        const second = { key: 'shared', value: null };
        const first = { key: 'shared', set value(_value) {
            second.key = 'other';
            LiveResource.refresh(second);
        } };
        resource.bind(first, 'value', owner => owner.key);
        resource.bind(second, 'value', owner => owner.key);
        expect(resource.publish('shared', 'stale')).toBe(2);
        expect(second.value).toBeNull();
        LiveResource.release(first);
        LiveResource.release(second);

        const third = { key: 'shared', value: null };
        const disposer = { key: 'shared', set value(_value) { LiveResource.release(third); } };
        resource.bind(disposer, 'value', owner => owner.key);
        resource.bind(third, 'value', owner => owner.key);
        expect(resource.publish('shared', 'stale')).toBe(2);
        expect(third.value).toBeNull();
        LiveResource.release(disposer);
    });

    test('releasing one property preserves another binding on the same page', () => {
        const resource = liveResource();
        const page = { key: 'shared', first: null, second: null };
        const first = resource.bind(page, 'first', owner => owner.key);
        resource.bind(page, 'second', owner => owner.key);
        expect(resource.release(first)).toBe(true);
        expect(resource.publish('shared', 'retained')).toBe(1);
        expect(page.first).toBeNull();
        expect(page.second).toBe('retained');
        LiveResource.release(page);
    });
});
