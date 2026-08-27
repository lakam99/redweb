import { LiveHtmlServer, LivePage, action, html, page, state } from 'redweb';

@page('/standard')
class StandardPage extends LivePage {
    @state({ writable: true })
    name = 'Redweb';

    @action()
    greet() {
        return html`<h1>Hello ${this.name}</h1>`;
    }

    render() {
        return '<h1>{{ name }}</h1>';
    }
}

new LiveHtmlServer({ pages: [StandardPage], listen: false });
