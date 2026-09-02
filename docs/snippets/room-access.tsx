import { randomBytes } from 'node:crypto';
import { page, defineApp, BaseHandler, SocketRoute, RedWebSocket, RedWebRequest, LivePageRequestContext } from 'redweb';

// A runnable local demonstration, not a production credential store.
export async function createApp(port = 8181) {
    const token = randomBytes(32).toString('base64url');
    let enabled = true;
    const authenticate = (request: Pick<RedWebRequest, 'headers'>) =>
        enabled && request.headers.authorization === `Bearer ${token}` ? 'alice' : false;

    @page('/', { authorize: context => context.principal === 'alice' })
    class Home {
        render({ principal }: LivePageRequestContext) { return <main><h1>Private workspace</h1><p>{principal}</p></main>; }
    }

    class Join extends BaseHandler {
        constructor() { super('join'); }
        async onMessage(socket: RedWebSocket) {
            socket.sendJson({ joined: await socket.enterRoom!('team'), principal: socket.context!.principal });
        }
    }
    class Team extends SocketRoute {
        constructor() {
            super({ path: '/team', handlers: [Join], allowDuplicateConnections: true, logger: null,
                admission: { authenticate },
                rooms: { authorize: (context, roomId) => enabled && context.principal === 'alice' && roomId === 'team' },
            });
        }
    }

    const app = defineApp({ pages: [Home], sockets: [Team], authenticate, port, bind: '127.0.0.1', logger: null });
    await app.run();
    const team = app.sockets!.routes.find(route => route instanceof Team)!;
    return {
        app, team, token,
        async revoke() {
            enabled = false; // Invalidate credentials and future permissions first.
            team.clients.forEach(socket => team.rooms!.leaveAll(socket));
            await app.revoke('alice');
        },
        shutdown: () => app.shutdown(),
    };
}

if (require.main === module) {
    createApp().then(demo => {
        console.log('Local demo: http://127.0.0.1:8181/ and ws://127.0.0.1:8181/team');
        console.log(`Authorization: Bearer ${demo.token}`); // One fresh local-demo credential per run.
    });
}
