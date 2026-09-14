import { action, component, defineApp, html, page, state } from 'redweb';

@component()
export class CounterComponent {
    @state()
    count = 0;

    constructor(private readonly label: string) {}

    @action()
    increment() {
        this.count += 1;
    }

    render() {
        return html`
            <article class="counter-card">
                <h2>${this.label}</h2>
                <output data-rw-state="count">${this.count}</output>
                <button type="button" rw-click="increment">Increment on the server</button>
            </article>
        `;
    }
}

@page('/', { css: 'components.css' })
export class ComponentsPage {
    primary = new CounterComponent('Primary counter');
    secondary = new CounterComponent('Independent counter');

    render() {
        return html`
            <main>
                <h1>Reusable server components</h1>
                <section class="counter-grid">${this.primary}${this.secondary}</section>
            </main>
        `;
    }
}

if (require.main === module) void defineApp({ pages: [ComponentsPage], port: 8080 }).run()
    .catch(error => { console.error(error); process.exitCode = 1; });
