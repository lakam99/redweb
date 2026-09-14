'use strict';

const { SocketServer, SocketRoute, BaseHandler } = require('../..');
const { SoakClients } = require('../../scripts/lib/SoakClients');
const { waitFor, silentLogger } = require('../../scripts/realtime-harness');
const { waitForCondition, withTimeout } = require('../helpers/network');

test('real soak rotation has a room-free phase before the replacement sends its next tick', async () => {
    class Join extends BaseHandler {
        constructor() { super('cycle'); }
        onMessage(socket, message) { socket.joinRoom(`room-${message.slot % 8}`); socket.sendJson({ tick: message.tick }); }
    }
    class Route extends SocketRoute {
        constructor() { super({ path: '/soak', handlers: [Join], allowDuplicateConnections: true, logger: silentLogger,
            orderedMessages: true, rooms: { maxRooms: 16, maxMembersPerRoom: 4, maxRoomsPerConnection: 2 } }); }
    }
    const server = new SocketServer({ port: 0, bind: '127.0.0.1', routes: [Route], logger: silentLogger });
    let clients;
    const failures = [];
    try {
        if (!server.server.listening) await waitFor(server.server, 'listening');
        const route = server.routes[0];
        clients = new SoakClients(`ws://127.0.0.1:${server.server.address().port}/soak`, 2, () => {});
        await clients.openInitial(); clients.sendTick(0);
        await waitForCondition(() => { clients.check(); return clients.received === 2; }, 'two joined clients');
        expect(route.clients.size).toBe(2); expect(route.rooms.size).toBe(2);
        await clients.rotate(0, () => false);
        await waitForCondition(() => route.clients.size === 2 && route.rooms.size === 1, 'replacement connected before rejoining');
        // This is a genuine observable state, not a mock or a leaked room.
        expect(route.rooms.members('room-0')).toHaveLength(0);
        expect(route.rooms.members('room-1')).toHaveLength(1);
        clients.sendTick(1);
        await waitForCondition(() => { clients.check(); return clients.received === 4; }, 'replacement rejoined');
        expect(route.clients.size).toBe(2); expect(route.rooms.size).toBe(2);
        expect(clients.sent).toBe(4); clients.check();
        await clients.closeAll();
        await waitForCondition(() => route.clients.size === 0 && route.rooms.size === 0, 'all room membership removed');
    } catch (error) { failures.push(error); }
    try { await clients?.closeAll(); } catch (error) { failures.push(error); }
    try { await withTimeout(server.shutdown(), 'room phase server shutdown', 10000); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Room phase regression failed', { cause: failures[0] });
}, 90000); // Acquisition, condition deadlines and independent client/server cleanup.
