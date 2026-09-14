import { action, defineApp, page, state } from 'redweb';

@page('/', { shared: true })
class CounterPage {
    @state() count = 0;

    @action()
    increment() { this.count += 1; }

    render() {
        return <button rw-click="increment">Count {this.count}</button>;
    }
}

const app = defineApp({ pages: [CounterPage] });
app.run();
