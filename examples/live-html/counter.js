const { LiveHtmlServer, LivePage, page, state } = require('../..');

class CounterPage extends LivePage {
    constructor() {
        super();
        this.count = 0;
        this.ticker = null;
    }

    connected() {
        this.ticker = setInterval(() => { this.count += 1; }, 1000);
    }

    disconnected() {
        clearInterval(this.ticker);
        this.ticker = null;
    }

    disposed() {
        clearInterval(this.ticker);
    }
}

state()(CounterPage.prototype, 'count');
page('/', { template: 'counter.htmx' })(CounterPage);

function createCounterServer(options = {}) {
    return new LiveHtmlServer({
        port: 8080,
        templateRoot: __dirname,
        pages: [CounterPage],
        ...options,
    });
}

if (require.main === module) createCounterServer();

module.exports = { CounterPage, createCounterServer };
