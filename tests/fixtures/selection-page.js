'use strict';

const { page, action, state } = require('../..');
const { jsx, jsxs } = require('../../jsx-runtime');

class SelectionPage {
    revision = 0;
    serverDefault = -1;
    redraw() { this.revision++; }
    changeDefault() { this.serverDefault = 2; this.revision++; }
    render() {
        const options = () => ['First', 'Second', 'Third'].map((label, index) =>
            jsx('option', { value: 'same', selected: this.serverDefault === index, children: label }, label));
        return jsxs('main', { children: [
            jsx('output', { id: 'revision', children: this.revision }),
            jsx('select', { id: 'single', children: options() }),
            jsx('select', { id: 'multiple', multiple: true, children: options() }),
            jsx('button', { id: 'redraw', 'rw-click': 'redraw', children: 'Redraw' }),
            jsx('button', { id: 'defaults', 'rw-click': 'changeDefault', children: 'Change default' }),
        ] });
    }
}
page('/')(SelectionPage);
for (const name of ['revision', 'serverDefault']) state()(SelectionPage.prototype, name);
for (const name of ['redraw', 'changeDefault']) action()(SelectionPage.prototype, name, Object.getOwnPropertyDescriptor(SelectionPage.prototype, name));
module.exports = SelectionPage;
