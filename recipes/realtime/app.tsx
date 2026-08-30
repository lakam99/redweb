import { action, page, start, state, type LiveHtmlServerOptions } from 'redweb';

@page('/', { css: 'app.css', shared: true })
export class CounterPage {
    @state() count = 0;

    @action()
    increment() { this.count += 1; }

    render() {
        return (
            <main class="home">
                <h1>A counter owned by the server</h1>
                <p>Open this page in two tabs. Either button updates both.</p>
                <button rw-click="increment">
                    Count <output>{this.count}</output>
                </button>
            </main>
        );
    }
}

export function createApp(options: Omit<LiveHtmlServerOptions, 'pages'> = {}) {
    return start(CounterPage, { port: Number(process.env.PORT ?? 8181), templateRoot: __dirname, ...options });
}

if (require.main === module) createApp();
