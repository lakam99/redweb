import { action, html, page, start, state, view } from 'redweb';

@page('/standard', { css: 'standard.css' })
class StandardPage {
    @state({ writable: true })
    name = 'Redweb';

    @action()
    greet() {
        return html`<h1>Hello ${this.name}</h1>`;
    }

    render() {
        return '<h1>{{ name }}</h1>';
    }

    @view('items')
    item(value: string) {
        return html`<span>${value}</span>`;
    }
}

void start(StandardPage, { listen: false }).shutdown();
