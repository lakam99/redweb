import { action, __DECORATOR__, state } from 'redweb';

__DECORATION__
export class __CLASS__ {
    @state() count = 0;

    @action()
    increment() { this.count += 1; }

    render() {
        return (
            <section>
                <h1>__TITLE__</h1>
                <button rw-click="increment">Count <output>{this.count}</output></button>
            </section>
        );
    }
}
