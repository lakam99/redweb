const { z } = require('zod');
const { action, component, page, state } = require('../..');
const { jsx, jsxs, Fragment } = require('../../jsx-runtime');

function createFeedbackPage(control) {
    class Form {
        calls = 0;
        completed = 0;
        slotVersion = 0;
        visible = true;
        constructor(name, slot = false) { this.name = name; this.slot = slot; control.forms.set(name, this); }
        async save({ message }) { return this.submit(message); }
        async click() { return this.submit('click'); }
        async submit(message) {
            this.calls += 1;
            await control.wait(message);
            this.completed += 1;
        }
        render() {
            return jsxs(Fragment, { children: [
                this.visible ? jsxs('form', { id: this.name, 'rw-submit': 'save', 'aria-label': 'Authored label', children: [
                    jsx('input', { name: 'message', value: '', 'aria-label': 'Message' }),
                    jsx('input', { name: 'reset', disabled: true, value: 'Named control must not shadow reset handling' }),
                    jsx('button', { type: 'submit', children: 'Save' }),
                    jsx('output', { children: this.completed }),
                    jsx('button', { type: 'button', 'rw-click': 'click', children: 'Click action' }),
                ] }) : null,
                this.slot ? jsx('p', { id: `${this.name}-status`, 'rw-status': 'save', role: 'status', 'aria-live': 'assertive', children: '' }, String(this.slotVersion)) : null,
            ] });
        }
    }
    component()(Form);
    state()(Form.prototype, 'completed');
    state()(Form.prototype, 'slotVersion');
    state()(Form.prototype, 'visible');
    action({
        input: z.object({ message: z.string().min(1).max(100) }).strict(),
        authorize: (_context, { message }) => message === 'policy timeout' ? new Promise(() => {}) : message !== 'denied',
        authorizationTimeoutMs: 50,
    })(Form.prototype, 'save', Object.getOwnPropertyDescriptor(Form.prototype, 'save'));
    action()(Form.prototype, 'click', Object.getOwnPropertyDescriptor(Form.prototype, 'click'));
    class Group {
        nested = new Form('nested', true);
        render() { return jsx('section', { children: this.nested }); }
    }
    component()(Group);
    class Page {
        first = new Form('first');
        second = new Form('second', true);
        group = new Group();
        tick = 0;
        version = 0;
        constructor() { control.page = this; }
        render() {
            return jsxs('main', { children: [
                jsx('p', { id: 'tick', children: this.tick }),
                jsx('section', { children: this.first }, String(this.version)),
                this.second, this.group,
            ] });
        }
    }
    page('/', { shared: true })(Page);
    state()(Page.prototype, 'tick');
    state()(Page.prototype, 'version');
    return Page;
}

module.exports = { createFeedbackPage };
