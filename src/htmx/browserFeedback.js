const fs = require('fs');

// Embed the same browser-safe source that unit tests execute, not its instrumented
// function.toString() representation. This introduces no browser dependency.
const actionFeedbackSource = fs.readFileSync(require.resolve('./ActionFeedback'), 'utf8');

function browserFeedback() {
    return `
const ActionFeedback = (() => {
    const module = { exports: {} };
    ${actionFeedbackSource}
    return module.exports;
})();
const bindingOf = source => JSON.stringify([componentOf(source), source.getAttribute('rw-submit'), source.getAttribute('rw-click')]);
const revisions = new WeakMap();
const feedbackNodes = new WeakMap();
const feedbackSources = new WeakMap();
const slotOwners = new WeakMap();
let feedbackSequence = 0;
const feedback = new ActionFeedback((source, record) => {
    if (record.binding === undefined) {
        record.source = source;
        record.order = ++feedbackSequence;
        record.binding = bindingOf(source);
        record.component = componentOf(source);
        record.node = feedbackNodes.get(source);
        record.name = source.getAttribute('rw-submit') || source.getAttribute('rw-click');
    }
    showFeedback(source, record);
}, report);
const clearSlot = (slot, owner) => {
    if (slot.textContent === owner.message) slot.textContent = '';
    if (slot.getAttribute('data-rw-status') === owner.status) slot.removeAttribute('data-rw-status');
    slotOwners.delete(slot);
};
const indexSlots = () => {
    const all = document.querySelectorAll('[rw-status]');
    const byAction = new Map();
    for (const slot of all) {
        const key = stateKey(componentOf(slot), slot.getAttribute('rw-status'));
        const entries = byAction.get(key) || [];
        entries.push(slot);
        byAction.set(key, entries);
    }
    return { all, byAction };
};
const showFeedback = (source, record, index = indexSlots()) => {
    if (!source.isConnected || record.binding !== bindingOf(source)) {
        record.node?.remove();
        for (const slot of index.all) {
            const owner = slotOwners.get(slot);
            if (owner?.record === record) clearSlot(slot, owner);
        }
        return;
    }
    source.setAttribute('data-rw-status', record.status);
    const slots = index.byAction.get(stateKey(record.component, record.name)) || [];
    if (slots.length) {
        record.node?.remove();
        for (const slot of slots) {
            if ((slotOwners.get(slot)?.record.order || 0) > record.order) continue;
            // An authored slot controls placement/accessibility; never replace its attributes.
            slot.textContent = record.message;
            slot.setAttribute('data-rw-status', record.status);
            slotOwners.set(slot, { record, message: record.message, status: record.status });
        }
    } else {
        if (!record.node) {
            record.node = document.createElement('span');
            record.node.setAttribute('data-rw-feedback', '');
            record.node.setAttribute('role', 'status');
            record.node.setAttribute('aria-live', 'polite');
            clientNodes.add(record.node);
            feedbackNodes.set(source, record.node);
            feedbackSources.set(record.node, source);
        }
        record.node.textContent = record.message;
        record.node.setAttribute('data-rw-status', record.status);
        if (source.localName === 'form') source.append(record.node);
        else source.after(record.node);
    }
};
const refreshFeedback = () => {
    document.documentElement.setAttribute('data-rw-connection', client.state);
    const slots = indexSlots();
    for (const slot of slots.all) {
        const owner = slotOwners.get(slot);
        if (owner && (!owner.record.source.isConnected || owner.record.binding !== bindingOf(owner.record.source) || slot.getAttribute('rw-status') !== owner.record.name || componentOf(slot) !== owner.record.component)) clearSlot(slot, owner);
    }
    for (const node of document.querySelectorAll('[data-rw-feedback]')) {
        const source = feedbackSources.get(node);
        if (source && !source.isConnected) node.remove();
    }
    for (const source of document.querySelectorAll('[rw-click],form[rw-submit]')) {
        const record = feedback.get(source);
        if (record) showFeedback(source, record, slots);
    }
};
const performAction = (source, payload, completed) => feedback.run(source, () => {
    if (client.state !== 'open') throw Object.assign(new Error('Action was not sent while disconnected.'), { code: 'ACTION_OFFLINE' });
    return client.request('redweb:html', payload);
}).then(success => { if (success) completed?.(); });
const noteDraftChange = event => {
    const form = event.target.form;
    if (form) revisions.set(form, (revisions.get(form) || 0) + 1);
};
document.addEventListener('input', noteDraftChange);
document.addEventListener('change', noteDraftChange);
`;
}

module.exports = browserFeedback;
