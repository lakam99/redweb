import { SocketRoute } from 'redweb';
import { defineSocketContract } from 'redweb/contract';
import { z } from 'zod';

// This example is stateless. Add application-owned identity and persistence as needed.
export const contract = defineSocketContract('1', {
    ping: z.object({ text: z.string().max(500) }).strict(),
    pong: z.object({ text: z.string().max(500) }).strict(),
});

export const Ping = contract.handler('ping', (socket, payload, message) =>
    contract.send(socket, 'pong', payload, { requestId: message.requestId }));

export class __CLASS__ extends SocketRoute {
    constructor() {
        super({
            path: '/__NAME__', handlers: [Ping], protocol: contract.protocol,
            orderedMessages: true,
            allowDuplicateConnections: true,
            websocketOptions: { maxPayload: 4096 },
            limits: { maxConnections: 100, maxPendingMessages: 32, maxBufferedBytes: 65536 },
        });
    }
}
