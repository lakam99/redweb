import { defineApp, page, state } from 'redweb';

@page('/', { template: 'counter.html', css: 'counter.css' })
export class CounterPage {
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

}

if (require.main === module) void defineApp({ pages: [CounterPage], port: 8080 }).run()
    .catch(error => { console.error(error); process.exitCode = 1; });
