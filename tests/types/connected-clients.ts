import { connectedClients, SocketRoute, state, page } from 'redweb';
import { defineSocketContract } from 'redweb/contract';
import { z } from 'zod';

const contract = defineSocketContract('1', { move: z.object({ cell: z.number() }) });
const clients = connectedClients({
    identity: context => typeof context.principal === 'string' ? context.principal : undefined,
    page: () => Board,
    project: (client, room, online) => ({ text: `${client.identity}:${room}:${online.join(',')}` }),
});
const Move = clients.bind(contract).handler('move', (client, { cell }) => {
    const identity: string = client.identity;
    const board: Board = client.page;
    board.text = `${identity}:${cell}`;
    // @ts-expect-error Payload inference is preserved through the adapter.
    cell.toUpperCase();
    // @ts-expect-error Identity is read-only.
    client.identity = 'other';
    // @ts-expect-error Membership snapshots are read-only.
    client.rooms.push('unowned');
});
class Route extends SocketRoute {
    constructor() { super({ path: '/match', handlers: [Move], protocol: contract.protocol, connections: clients }); }
}
@page('/', { socket: Route })
class Board { @state() text = ''; render() { return this.text; } }
Move.with({ cell: 1 });
// @ts-expect-error Controls retain the original contract input type.
Move.with({ cell: 'wrong' });
