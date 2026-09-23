const { z } = require('zod');
const { action, page, component, state } = require('../..');
const { jsx, jsxs } = require('../../jsx-runtime');

// Zod's object parser deliberately ignores __proto__; inspect it before parsing
// so the browser gate proves that form serialization preserves this field.
const input = z.unknown().refine(value => value == null || !Object.hasOwn(value, '__proto__'))
    .pipe(z.object({ amount: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(1000)) }).strict());
class ActionForm {
    total = 0;
    calls = 0;
    save(input, context) {
        this.calls += 1;
        this.total += input.amount;
        return { total: this.total, principal: context.principal };
    }
    render() {
        return jsxs('form', { 'rw-submit': 'save', children: [
            jsx('input', { name: 'amount', value: '', 'aria-label': 'Amount' }),
            jsx('button', { type: 'submit', children: 'Add' }),
            jsx('output', { children: this.total }),
        ] });
    }
}
component()(ActionForm);
state()(ActionForm.prototype, 'total');
action({ input })(ActionForm.prototype, 'save', Object.getOwnPropertyDescriptor(ActionForm.prototype, 'save'));

function createActionPage() {
    class ActionPage {
        first = new ActionForm();
        second = new ActionForm();
        render() { return jsxs('main', { children: [this.first, this.second] }); }
    }
    page('/', { shared: true })(ActionPage);
    return ActionPage;
}

module.exports = { createActionPage, ActionForm };
