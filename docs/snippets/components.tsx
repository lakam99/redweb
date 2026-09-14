import { action, component, defineApp, page, state } from 'redweb';

@component()
class Counter {
    @state() count = 0;

    @action()
    increment() { this.count += 1; }

    render() {
        return <button rw-click="increment">Count {this.count}</button>;
    }
}

@page('/')
class CountersPage {
    first = new Counter();
    second = new Counter();

    render() { return <main>{this.first}{this.second}</main>; }
}

const app = defineApp({ pages: [CountersPage] });
app.run();
