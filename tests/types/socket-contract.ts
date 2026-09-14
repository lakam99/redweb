import { z } from 'zod';
import { defineSocketContract, SocketRoute, type RedWebSocket } from 'redweb';
import { defineSocketContract as standalone } from 'redweb/contract';
import type { SendableSocket } from 'redweb/client';
import type { SocketSchema } from 'redweb/contract';

const promised: SocketSchema<null, Promise<number>> = {
    '~standard': { version: 1, validate: () => ({ value: Promise.resolve(1) }) },
};
defineSocketContract('1', { promised }).handler('promised', (_socket, payload) => {
    const value: number = payload;
    void value;
    // @ts-expect-error Thenable outputs are awaited within the validation deadline.
    const unresolved: Promise<number> = payload;
    void unresolved;
});

const match = defineSocketContract('1', {
    join: z.object({ name: z.string().min(1).max(40) }),
    move: z.object({ x: z.number(), y: z.number() }),
    resume: z.object({ session: z.string().transform(value => value.length) }),
});
const Join = match.handler('join', (socket, payload, message) => {
    const name: string = payload.name;
    const type: 'join' = message.type;
    void socket;
    void name;
    void type;
    // @ts-expect-error A join payload has no x coordinate.
    void payload.x;
});
const Resume = match.handler('resume', (_socket, payload) => {
    const length: number = payload.session;
    void length;
    // @ts-expect-error Receiver-side transformations infer their output, not their wire input.
    const wrong: string = payload.session;
    void wrong;
});
new SocketRoute({ path: '/match', handlers: [Join, Resume], protocol: match.protocol });

function clientChecks(socket: SendableSocket, serverSocket: RedWebSocket) {
    const client = match.client(socket);
    void client.send('join', { name: 'Ada' });
    void client.send('move', { x: 1, y: 2 });
    void client.send('resume', { session: 'token' });
    void match.send(serverSocket, 'move', { x: 0, y: 0 });
    // @ts-expect-error Unknown message type.
    void client.send('shoot', {});
    // @ts-expect-error Incorrect payload shape.
    void client.send('move', { x: 'left', y: 2 });
    // @ts-expect-error Senders use input types, not transformed outputs.
    void client.send('resume', { session: 5 });
    // @ts-expect-error Required fields cannot be omitted.
    void match.send(serverSocket, 'join', {});
    void client.parse('{"v":"1","type":"join","payload":{"name":"Ada"}}').then(message => {
        if (message.type === 'join') {
            const name: string = message.payload.name;
            void name;
        }
        if (message.type === 'resume') {
            const length: number = message.payload.session;
            void length;
        }
    });
}
void clientChecks;
void standalone;
