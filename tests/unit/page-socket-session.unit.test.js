'use strict';

const { attachRawClient, requirePageSession, requireRawClient } = require('../../src/htmx/PageSocketRoute');

test('page-bound socket work requires the attached page session', () => {
    const session = {};
    expect(requirePageSession(session)).toBe(session);
    expect(() => requirePageSession(undefined)).toThrow('This operation is not permitted.');
    expect(() => requirePageSession(null)).toThrow('This operation is not permitted.');
});

test('raw access is marked only for the exact upgrade request admitted by the route', () => {
    const admitted = {}, outsider = {}, requests = new WeakSet([admitted]);
    const socket = {};
    expect(() => attachRawClient(socket, outsider, requests)).toThrow('This operation is not permitted.');
    expect(() => requireRawClient(socket)).toThrow('This operation is not permitted.');
    attachRawClient(socket, admitted, requests);
    expect(requireRawClient(socket)).toBeUndefined();
});
