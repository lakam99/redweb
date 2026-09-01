import { action, component, page, state } from '../..';

export let constructions = 0;

@component()
class Counter {
    @state() count = 0;
    @action() increment() { this.count++; this.count++; }
    render() { return <output>{this.count}</output>; }
}

@page('/')
export class InspectionPage {
    counter = new Counter();
    @state() password = 'state-secret';
    @state() unused = 0;
    constructor() { constructions++; }
    @action() nothing() { this.unused++; }
    render() { return <main>{this.counter}</main>; }
}
