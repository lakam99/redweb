import type { LiveHtmlServerOptions } from 'redweb';

const { LiveHtmlServer, LivePage, page, state }: typeof import('redweb') = require('../..');

@page('/', { template: 'counter.htmx' })
export class CounterPage extends LivePage {
    @state()
    count = 0;

    private ticker: NodeJS.Timeout | null = null;

    connected() {
        this.ticker = setInterval(() => { this.count += 1; }, 1000);
    }

    disconnected() {
        if (this.ticker) clearInterval(this.ticker);
        this.ticker = null;
    }

    disposed() {
        if (this.ticker) clearInterval(this.ticker);
    }
}

export function createCounterServer(options: Omit<LiveHtmlServerOptions, 'pages'> = {}) {
    return new LiveHtmlServer({
        port: 8080,
        templateRoot: __dirname,
        pages: [CounterPage],
        ...options,
    });
}

if (require.main === module) createCounterServer();
