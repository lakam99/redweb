'use strict';

const { requirePageSession } = require('../../src/htmx/PageSocketRoute');

test('page-bound socket work requires the attached page session', () => {
    const session = {};
    expect(requirePageSession(session)).toBe(session);
    expect(() => requirePageSession(undefined)).toThrow('This operation is not permitted.');
    expect(() => requirePageSession(null)).toThrow('This operation is not permitted.');
});
