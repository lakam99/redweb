import { defineSocketContract, type RedWebSocket } from 'redweb';
import { z } from 'zod';
const contract = defineSocketContract('1', { move: z.object({ cell: z.number(), revision: z.number() }) });
const Move = contract.handler('move', (_socket, input) => { input.cell.toFixed(); });
Move.with({ cell: 1, revision: 2 });
// @ts-expect-error Commands require the declared payload.
Move.with({ cell: 1 });
// @ts-expect-error Payload types are inferred from the contract.
Move.with({ cell: '1', revision: 2 });
class Board { value = 1; }
export function usePage(socket: RedWebSocket) {
    if (socket.page) {
        socket.page(Board).value.toFixed();
        // @ts-expect-error Page members retain their concrete types.
        socket.page(Board).missing;
    }
}
