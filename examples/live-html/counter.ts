import { page, start, state } from 'redweb';

@page('/', { template: 'counter.htmx', css: 'counter.css' })
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

if (require.main === module) start(CounterPage, { port: 8080 });
