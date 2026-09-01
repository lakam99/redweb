'use strict';

const vm = require('node:vm');
const { headingReady } = require('../../scripts/lib/verify-refresh-controls');

// Explicit pure expression units; the refresh browser gate separately evaluates
// these exact expressions against actual HTTP documents in native Chromium.
test('heading readiness requires exact text and tolerates an absent element', () => {
    for (const text of ['Away', 'Revision fixture', 'quotes " and \\ escapes']) {
        const expression = headingReady(text);
        for (const [heading, expected] of [[null, false], [{ textContent: 'wrong' }, false], [{ textContent: text }, true]]) {
            expect(vm.runInNewContext(expression, { document: { querySelector: selector => {
                expect(selector).toBe('h1'); return heading;
            } } })).toBe(expected);
        }
        expect(() => vm.runInNewContext(expression, { document: { querySelector() { throw new Error('unrelated'); } } })).toThrow('unrelated');
    }
});
