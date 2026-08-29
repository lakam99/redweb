import { LivePage, action, component, page, start, state } from 'redweb';
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
                        Count <output data-rw-state="count">{this.count}</output>
                    </button>
                </Card>
            </main>
        );
    }
}

if (require.main === module) start(JsxPage, { port: 8181 });
