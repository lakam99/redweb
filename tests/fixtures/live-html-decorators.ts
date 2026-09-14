import { LiveHtmlServer, LivePage, action, html, page, state } from '../..';

@page('/compiled')
export class CompiledPage extends LivePage {
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

class DecoratedBasePage extends LivePage {
    @action()
    run() {
        return 'decorated';
    }
}

export class ShadowedCompiledPage extends DecoratedBasePage {
    run = () => 'shadow';
}

export const createCompiledServer = () => new LiveHtmlServer({ pages: [CompiledPage], listen: false });
