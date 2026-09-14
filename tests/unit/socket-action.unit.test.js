'use strict';
const { z } = require('zod');
const { defineSocketContract, page } = require('../..');
const { jsx } = require('../../jsx-runtime');
const { withRoute, attributes } = require('../../src/htmx/SocketAction');

test('typed socket bindings are identity-checked, escaped and snapshotted without executing handlers', () => {
    const contract = defineSocketContract('1', { move: z.object({ text: z.string() }) });
    let called = false;
    const Move = contract.handler('move', () => { called = true; });
    const Wrong = contract.handler('move', () => {});
    expect(() => jsx('button', { 'rw-click': Move })).toThrow('belong');
    expect(() => withRoute(new Set([Wrong]), () => jsx('button', { 'rw-click': Move }))).toThrow('belong');
    withRoute(new Set([Move]), () => {
        const input = { text: '<img src=x onerror="bad">' };
        const bound = Move.with(input); input.text = 'mutated';
        const markup = jsx('button', { 'rw-click': bound }).toString();
        expect(markup).toContain('&lt;img'); expect(markup).not.toContain('<img'); expect(markup).not.toContain('mutated');
        expect(jsx('form', { 'rw-submit': Move }).toString()).toContain('rw-submit="move"');
        expect(() => jsx('button', { 'rw-click': Move, 'data-rw-command': '{}' })).toThrow('Only one');
        expect(() => jsx('button', { 'rw-click': Move, 'rw-submit': Move })).toThrow('Only one');
    });
    expect(called).toBe(false);
    const props = { 'rw-click': 'existing-action' }; expect(attributes(props)).toBe(props);
    for (const payload of [undefined, 1n, 'x'.repeat(65537)]) expect(() => Move.with(payload)).toThrow();
    const cyclic = {}; cyclic.self = cyclic; expect(() => Move.with(cyclic)).toThrow();
});

test('socket pages reject static/shared or non-class configuration', () => {
    for (const options of [{ socket: '/match' }, { socket: class {}, live: false }, { socket: class {}, shared: true }]) {
        expect(() => page('/', options)).toThrow('socket requires');
    }
});
