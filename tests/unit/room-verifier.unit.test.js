'use strict';

// Explicit unit fault injection; documentation/example integration tests use
// actual sockets, HTTP, compilation and application shutdown.
jest.mock('ws', () => class extends require('node:events').EventEmitter {
    send() { this.emit('message', JSON.stringify({ joined: true, principal: 'alice' })); }
});
jest.mock('../helpers/network', () => ({
    waitForListening: jest.fn(), waitForOpen: jest.fn(), closeWebSocket: jest.fn(),
    websocketUpgradeStatus: jest.fn().mockResolvedValue(401),
}));
const WebSocket = require('ws');
const network = require('../helpers/network');
const { verifyRoomApplication } = require('../../scripts/lib/verify-room-example');
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

test.each([
    [false, false, false], [false, true, false], [false, false, true], [false, true, true],
    [true, false, false], [true, true, false], [true, false, true], [true, true, true],
])('room cleanup preserves primary=%s, socket=%s and shutdown=%s failures', async (primary, socketFailure, shutdownFailure) => {
    const primaryError = new Error('primary verification failure');
    const socketError = new Error('socket cleanup failure');
    const shutdownError = new Error('server cleanup failure');
    network.waitForListening.mockReset();
    network.closeWebSocket.mockReset();
    if (primary) network.waitForListening.mockRejectedValue(primaryError);
    if (socketFailure) network.closeWebSocket.mockRejectedValue(socketError);
    let revoked = false, peer;
    jest.spyOn(WebSocket.prototype, 'send').mockImplementation(function () {
        peer = this;
        this.emit('message', JSON.stringify({ joined: true, principal: 'alice' }));
    });
    global.fetch = jest.fn().mockResolvedValueOnce({ status: 401 })
        .mockResolvedValueOnce({ status: 200, text: async () => '<p>alice</p>' })
        .mockResolvedValueOnce({ status: 401 });
    const demo = { token: 'unit-only', app: { server: { address: () => ({ port: 1 }) } },
        team: { rooms: { broadcast: (_room, message) => {
            if (revoked) return 0;
            peer.emit('message', JSON.stringify(message)); return 1;
        } } },
        revoke: async () => { revoked = true; }, shutdown: jest.fn(),
    };
    if (shutdownFailure) demo.shutdown.mockRejectedValue(shutdownError);
    let failure;
    try { await verifyRoomApplication(demo); } catch (error) { failure = error; }
    expect(network.closeWebSocket).toHaveBeenCalledTimes(1);
    expect(demo.shutdown).toHaveBeenCalledTimes(1);
    const expected = [primary && primaryError, socketFailure && socketError, shutdownFailure && shutdownError].filter(Boolean);
    const flatten = error => error instanceof AggregateError ? error.errors.flatMap(flatten) : [error];
    expect(failure ? flatten(failure) : []).toEqual(expected);
    if (expected.length) expect(failure.message).toBe(expected[0].message);
    if (expected.length === 1) expect(failure).toBe(expected[0]);
});
