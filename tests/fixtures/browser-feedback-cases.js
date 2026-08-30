'use strict';

// Browser unit-style ownership checks supplement the actual HTTP/WebSocket driver.
// The client, DOM, event APIs and timers are never replaced.
async function runFeedbackCases() {
    const { feedback, showFeedback, refreshFeedback, slotOwners, revisions } = window.feedbackTest;
    let assertions = 0;
    const check = (condition, label) => { assertions++; if (!condition) throw new Error(label); };
    const root = document.createElement('section');
    root.innerHTML = '<button rw-click="save">Save</button><button rw-click="save">Also save</button><p rw-status="save" role="status" aria-live="assertive"></p><form rw-submit="submit"><input name="value"></form><input>';
    document.body.append(root);
    const [first, second] = root.querySelectorAll('button');
    const slot = root.querySelector('p');
    const form = root.querySelector('form');
    // Direct state-machine failures are unit cases, not simulated network failures.
    for (const error of [undefined, { code: 'toString' }, { code: 'ACTION_CANCELLED' }, { code: 'ACTION_VALIDATION_TIMEOUT' }, { code: 'ACCESS_CANCELLED' }]) {
        const record = { status: 'pending', message: 'Working…' };
        feedback.fail(first, record, error);
        check(record.status === 'error' && !record.message.includes('undefined'), 'sanitized unit failure');
    }
    const older = { status: 'pending', message: 'Working…' };
    const newer = { status: 'success', message: 'Done.' };
    feedback.changed(first, older);
    feedback.changed(second, newer);
    showFeedback(first, older);
    check(slot.textContent === 'Done.' && slotOwners.get(slot).record === newer, 'newer source owns shared slot');
    check(slot.getAttribute('aria-live') === 'assertive', 'authored accessibility survives ownership changes');
    second.setAttribute('rw-click', 'other');
    slot.textContent = 'Authored replacement';
    slot.setAttribute('data-rw-status', 'authored');
    refreshFeedback();
    check(slot.textContent === 'Authored replacement' && slot.getAttribute('data-rw-status') === 'authored', 'cleanup preserves authored text and status changes');
    check(!slotOwners.has(slot), 'rebound source releases slot ownership');
    showFeedback(first, older);
    slot.setAttribute('rw-status', 'other');
    refreshFeedback();
    check(!slotOwners.has(slot) && slot.textContent === '', 'retargeted slot releases old action');
    slot.setAttribute('rw-status', 'save');
    showFeedback(first, older);
    slot.setAttribute('data-rw-component', 'different');
    refreshFeedback();
    check(!slotOwners.has(slot) && !slot.hasAttribute('data-rw-status'), 'moved component slot releases old scope');
    slot.removeAttribute('data-rw-component');
    showFeedback(first, older);
    first.remove();
    showFeedback(first, older);
    check(slot.textContent === '' && !slotOwners.has(slot), 'detached source cannot paint its old slot');
    const fallback = { status: 'pending', message: 'Working…' };
    feedback.changed(form, fallback);
    const fallbackNode = fallback.node;
    check(fallbackNode.parentNode === form && fallbackNode.getAttribute('aria-live') === 'polite', 'form fallback is accessible');
    form.querySelector('input').dispatchEvent(new Event('change', { bubbles: true }));
    form.querySelector('input').dispatchEvent(new Event('input', { bubbles: true }));
    root.lastChild.dispatchEvent(new Event('input', { bubbles: true }));
    check(revisions.get(form) === 2, 'only form controls revise a form draft');
    const formSlot = document.createElement('p');
    formSlot.setAttribute('rw-status', 'submit');
    root.append(formSlot);
    showFeedback(form, fallback);
    check(!fallbackNode.isConnected && formSlot.textContent === 'Working…', 'authored slot replaces fallback');
    formSlot.remove();
    showFeedback(form, fallback);
    check(fallback.node === fallbackNode && fallbackNode.isConnected, 'removed slot restores the same fallback node');
    form.setAttribute('rw-submit', 'changed');
    showFeedback(form, fallback);
    check(!fallbackNode.isConnected, 'rebound form removes fallback');
    // An authored lookalike is not owned by the runtime and must remain untouched.
    const authored = document.createElement('span');
    authored.setAttribute('data-rw-feedback', '');
    root.append(authored);
    refreshFeedback();
    check(authored.isConnected, 'authored lookalike is not removed as an orphan');
    root.remove();
    refreshFeedback();
    return { assertions };
}

module.exports = runFeedbackCases;
