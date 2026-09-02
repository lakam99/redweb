import { LivePage, action, component, defineApp, page, state } from 'redweb';
import type { Child } from 'redweb/jsx-runtime';

interface CardProperties {
    title: string;
    children?: Child;
}

const Card = component(({ title, children }: CardProperties) => (
    <article class="counter-card">
        <h2>{title}</h2>
        {children}
    </article>
));

@page('/jsx', { css: 'components.css' })
export class JsxPage extends LivePage {
    @state()
    count = 0;

    @action()
    increment() {
        this.count += 1;
    }

    render() {
        return (
            <main class="page-shell">
                <h1>Redweb JSX</h1>
                <Card title="Server rendered">
                    <p>Plain TSX, escaped by default, with no browser framework.</p>
                    <button type="button" rw-click="increment">
                        Count {this.count}
                    </button>
                </Card>
            </main>
        );
    }
}

if (require.main === module) void defineApp({ pages: [JsxPage], port: 8181 }).run()
    .catch(error => { console.error(error); process.exitCode = 1; });
