import { action, page, start, state, type LiveHtmlStartOptions } from 'redweb';
import { runApp } from './run-app';

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
                    Count {this.count}
                </button>
            </main>
        );
    }
}

export function createApp(options: LiveHtmlStartOptions = {}) {
    return start(CounterPage, { port: Number(process.env.PORT ?? 8181), templateRoot: __dirname, ...options });
}

if (require.main === module) runApp(createApp);
