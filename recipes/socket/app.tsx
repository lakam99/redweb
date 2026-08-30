import { SocketRoute, SocketServer, type SocketServerOptions } from 'redweb';
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

export function createApp(options: SocketServerOptions = {}) {
    return new SocketServer({
        port: Number(process.env.PORT ?? 8181),
        routes: [MatchRoute],
        ...options,
    });
}

if (require.main === module) createApp();
