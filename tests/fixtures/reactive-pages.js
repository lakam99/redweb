const { page, state, action, component } = require('../..');
const { jsx, jsxs, Fragment } = require('../../jsx-runtime');

function actions(Type, ...names) {
    for (const name of names) action()(Type.prototype, name, Object.getOwnPropertyDescriptor(Type.prototype, name));
}

class ReactiveCounter {
    count = 0;
    draft = '';
    increment() { this.count += 1; this.count += 1; }
    render() {
        return jsxs('section', { class: 'reactive-counter', children: [
            jsx('output', { class: 'derived', children: this.count * 2 }),
            jsx('span', { 'data-rw-state': 'count', children: this.count }),
            jsx('input', { 'rw-bind': 'draft', value: this.draft }),
            jsx('button', { 'rw-click': 'increment', children: 'Increment' }),
        ] });
    }
}
component()(ReactiveCounter);
state()(ReactiveCounter.prototype, 'count');
state({ writable: true })(ReactiveCounter.prototype, 'draft');
actions(ReactiveCounter, 'increment');

class NestedCounter {
    leaf = new ReactiveCounter();
    render() { return jsx('aside', { children: this.leaf }); }
}
component()(NestedCounter);

class ReactivePage {
    primary = new ReactiveCounter();
    secondary = new ReactiveCounter();
    nested = new NestedCounter();
    items = ['a', 'b', 'c'];
    visible = true;
    unused = 0;
    controlsChanged = false;
    reverse() { this.items = [...this.items].reverse(); }
    toggle() { this.visible = !this.visible; }
    nothing() { this.unused += 1; }
    controls() { this.controlsChanged = true; }
    render(context) {
        return jsxs('main', { children: [
            jsx('h1', { children: 'Automatic rendering' }),
            jsx('p', { id: 'visitor', children: context.query?.visitor || 'anonymous' }),
            this.visible ? jsx('div', { id: 'primary', children: this.primary }) : jsx('p', { id: 'hidden', children: 'Hidden' }),
            jsx('div', { id: 'secondary', children: this.secondary }),
            this.nested,
            jsxs('div', { id: 'controls', children: [
                jsx('input', { id: 'server-input', type: this.controlsChanged ? 'number' : 'text', value: this.controlsChanged ? '42' : 'initial' }),
                jsx('textarea', { id: 'server-textarea', children: this.controlsChanged ? 'server text' : 'initial text' }),
                jsx('input', { id: 'server-checkbox', type: 'checkbox', checked: this.controlsChanged }),
                jsxs('select', { id: 'server-select', children: [
                    jsx('option', { value: 'a', selected: !this.controlsChanged, children: 'A' }),
                    jsx('option', { value: 'b', selected: this.controlsChanged, children: 'B' }),
                ] }),
                jsx('button', { id: 'update-controls', 'rw-click': 'controls', children: 'Set server values' }),
            ] }),
            jsx('ul', { children: this.items.map(id => jsxs(Fragment, { children: [
                jsx('li', { 'data-item': id, children: jsx('input', { name: id, value: id }) }),
                jsx('li', { children: `Description ${id}` }),
            ] }, id)) }),
            jsx('button', { id: 'reverse', 'rw-click': 'reverse', children: 'Reverse' }),
            jsx('button', { id: 'toggle', 'rw-click': 'toggle', children: 'Toggle' }),
        ] });
    }
}
for (const name of ['items', 'visible', 'unused', 'controlsChanged']) state()(ReactivePage.prototype, name);
actions(ReactivePage, 'reverse', 'toggle', 'nothing', 'controls');
page('/')(ReactivePage);

class SharedReactivePage extends ReactivePage {}
page('/', { shared: true })(SharedReactivePage);

module.exports = { ReactivePage, SharedReactivePage, ReactiveCounter };
