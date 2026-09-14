'use strict';

const assert = require('node:assert/strict');
const { waitForCondition } = require('../../tests/helpers/network');

/** Public mount/dispose lifecycle exercised in the actual browser document. */
async function verifyLivePageOwnership(tab, { server, control, finish }, eventual) {
    let assertions = 0;
    const check = async (expression, label) => {
        assert.equal(await tab.evaluate(expression), true, label);
        assertions++;
    };
    await check('mountLivePage() === pageClient && !pageClient.disposed', 'mount is idempotent');
    const previousCalls = control.forms.get('first').calls;
    await tab.evaluate(`(() => {
        const form = document.getElementById('first');
        form.elements.message.value = 'dispose-pending';
        form.requestSubmit();
    })()`);
    await waitForCondition(() => control.forms.get('first').calls > previousCalls,
        'form submitted before disposal');
    await tab.evaluate(eventual(`document.getElementById('first').getAttribute('data-rw-status') === 'pending'`, 'pending disposal form'));
    await tab.evaluate(`(() => {
        for (const [id, attribute] of [['authored-status', 'rw-status'], ['authored-feedback', 'data-rw-feedback']]) {
            const node = document.createElement('span');
            node.id = id; node.setAttribute(attribute, 'unowned'); node.textContent = 'Keep me';
            document.body.append(node);
        }
    })()`);
    await tab.evaluate('pageClient.dispose(); pageClient.dispose();');
    await waitForCondition(() => [...server.manager.active.values()].every(session => !session.socket && !session.detaching),
        'disposed page socket detached from its retained reconnect session');
    await finish('dispose-pending');
    await check(`pageClient.disposed && pageClient.client.state === 'closed' &&
        document.documentElement.getAttribute('data-rw-connection') === 'closed' &&
        !document.getElementById('first').hasAttribute('data-rw-status') &&
        !document.querySelector('#first [data-rw-feedback]')`, 'dispose removes owned pending feedback and closes transport');
    await check(`document.getElementById('authored-status').textContent === 'Keep me' &&
        document.getElementById('authored-feedback').textContent === 'Keep me'`, 'dispose preserves unowned authored content');
    await check(`(() => {
        const config = document.getElementById('__redweb_page');
        const original = config.textContent;
        try {
            config.textContent = '{';
            try { mountLivePage(); return false; } catch (error) { return error instanceof SyntaxError; }
        } finally { config.textContent = original; }
    })()`, 'failed configuration does not poison a later mount');
    await tab.evaluate(`(() => {
        window.retiredPage = pageClient;
        document.addEventListener('redweb:connection', () => {
            window.nestedPage = mountLivePage();
        }, { once: true });
        window.pageClient = mountLivePage();
    })()`);
    await tab.evaluate(eventual('pageClient.client.state === "open"', 'remounted connection'));
    await check('pageClient !== retiredPage && nestedPage === pageClient && !pageClient.disposed && mountLivePage() === pageClient', 'reentrant mount shares exactly one owner');
    assert.equal(server.manager.active.size, 1);
    assertions++;
    await tab.evaluate(`(() => {
        const form = document.getElementById('first');
        form.elements.message.value = 'reply-disposal';
        pageClient.client.onAny(message => { if (message.requestId) pageClient.dispose(); });
        form.requestSubmit();
    })()`);
    await finish('reply-disposal');
    await tab.evaluate(eventual('pageClient.disposed', 'dispose from actual action reply'));
    await check(`document.getElementById('first').elements.message.value === 'reply-disposal'`, 'successful continuation cannot reset a draft after disposal');
    return { assertions };
}

module.exports = { verifyLivePageOwnership };
