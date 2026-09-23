import { defineApp, page, SocketRoute, type ApplicationService, type ApplicationContext } from 'redweb';

@page('/')
class HomePage { render() { return <h1>Home</h1>; } }
@page('/about', { live: false })
class AboutPage { render() { return <h1>About</h1>; } }
class MatchRoute extends SocketRoute {
    constructor() { super({ path: '/match', handlers: [] }); }
}
class Simulation implements ApplicationService {
    onInit(app: ApplicationContext, signal: AbortSignal) {
        app.app.get('/ready', (_request, response) => response.json({ ok: !signal.aborted }));
    }
    async onShutdown() {}
}
const app = defineApp({ pages: [HomePage, AboutPage], sockets: [MatchRoute], services: [Simulation], port: 8181 });
async function entry() {
    const running = await app.run();
    running.server.address();
    await app.shutdown();
}
void entry;
// @ts-expect-error HTTP descriptors are not application-wide service classes.
defineApp({ services: [{ serviceName: '/health', method: 'get', function: () => {} }] });
// @ts-expect-error Startup is owned by run(), not a listen flag.
defineApp({ listen: true });
