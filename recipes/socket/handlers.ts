import { randomUUID } from 'node:crypto';
import type { RedWebSocket } from 'redweb';
import { match } from './contract';

class Player {
    readonly session = randomUUID();
    x = 0;
    y = 0;
    constructor(readonly name: string) {}
}

function requireUnjoined(socket: RedWebSocket) {
    if (socket.context?.session) throw new Error('Already joined.');
}

function currentPlayer(socket: RedWebSocket) {
    const session = socket.context?.session as { data?: unknown } | null | undefined;
    if (!(session?.data instanceof Player)) throw new Error('Join or resume first.');
    return session.data;
}

export const Join = match.handler('join', (socket, { name }, message) => {
    requireUnjoined(socket);
    const player = new Player(name);
    if (!socket.createSession?.(player.session, player)) throw new Error('Session capacity reached.');
    return match.send(socket, 'state', player, { requestId: message.requestId });
});

export const Move = match.handler('move', (socket, { x, y }, message) => {
    const player = currentPlayer(socket);
    player.x = x;
    player.y = y;
    return match.send(socket, 'state', player, { requestId: message.requestId });
});

export const Resume = match.handler('resume', (socket, { session }, message) => {
    requireUnjoined(socket);
    if (!(socket.resumeSession?.(session) instanceof Player)) throw new Error('Session expired or unknown.');
    return match.send(socket, 'state', currentPlayer(socket), { requestId: message.requestId });
});
