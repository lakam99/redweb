import { defineApp, SocketRoute } from 'redweb';
import { match } from './contract';
import { Join, Move, Resume } from './handlers';

export class MatchRoute extends SocketRoute {
    constructor() {
        super({
            path: '/match',
            handlers: [Join, Move, Resume],
            protocol: match.protocol,
            orderedMessages: true,
            sessions: { ttlMs: 30000, maxSessions: 100 },
            heartbeat: { intervalMs: 15000, timeoutMs: 10000 },
            allowDuplicateConnections: true,
            websocketOptions: { maxPayload: 4096 },
            limits: { maxConnections: 100, maxPendingMessages: 32, maxBufferedBytes: 65536 },
        });
    }
}

export const app = defineApp({ sockets: [MatchRoute], port: Number(process.env.PORT ?? 8181) });

if (require.main === module) void app.run().catch(error => { console.error(error); process.exitCode = 1; });
