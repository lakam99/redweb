import { action, defineApp, page, state } from 'redweb';

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

export const app = defineApp({ pages: [CounterPage], port: Number(process.env.PORT ?? 8181), templateRoot: __dirname });

if (require.main === module) void app.run().catch(error => { console.error(error); process.exitCode = 1; });
