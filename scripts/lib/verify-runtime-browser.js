'use strict';

const assert = require('node:assert/strict');
const { waitForCondition } = require('../../tests/helpers/network');

/** Real frames and native DOM events supplement the canonical action driver. */
async function verifyRuntimeBrowser(tab, { server, control, finish }, eventual) {
    let assertions = 0;
    const check = async (expression, label) => {
        assert.equal(await tab.evaluate(expression), true, label);
        assertions++;
    };
    await tab.evaluate(`(() => {
        window.runtimeErrors = [];
        document.addEventListener('redweb:error', event => runtimeErrors.push(String(event.detail?.message || event.detail)));
        const root = document.createElement('section');
        root.id = 'runtime-fixture';
        root.innerHTML = '<p data-rw-state="label"></p><p data-rw-state="label"></p><div data-rw-state="markup"></div><input rw-bind="label"><input type="checkbox" rw-bind="checked"><section data-rw-component="scope"><p data-rw-state="label"></p><input rw-bind="label"></section><form id="ordinary"><input name="same" value="a"><input name="same" value="b"><input name="same" value="c"><input name="__proto__" value="safe"></form>';
        document.body.append(root);
        runtimeTest.indexState();
    })()`);
    const send = async (type, payload) => {
        const session = [...server.manager.active.values()][0];
        assert.ok(session, 'An actual live session must exist');
        session.socket.sendEvent(type, payload);
    };
    for (const value of ['hello', 'hello']) {
        await send('redweb:state', { name: 'label', value });
        await tab.evaluate(eventual(`document.querySelector('#runtime-fixture > input').value === 'hello'`, 'text binding'));
    }
    await check(`Array.from(document.querySelectorAll('#runtime-fixture > p')).every(node => node.textContent === 'hello') && document.querySelector('[data-rw-component="scope"] p').textContent === ''`, 'root updates all root targets, not component targets');
    await send('redweb:state', { name: 'label', component: 'scope', value: 'private' });
    await tab.evaluate(eventual(`document.querySelector('[data-rw-component="scope"] input').value === 'private'`, 'scoped binding'));
    await check(`document.querySelector('[data-rw-component="scope"] p').textContent === 'private'`, 'component state stays scoped');
    for (const [value, expected] of [[true, true], ['true', true], ['false', false]]) {
        await send('redweb:state', { name: 'checked', value });
        await tab.evaluate(eventual(`document.querySelector('#runtime-fixture [type="checkbox"]').checked === ${expected}`, 'checkbox binding'));
        assertions++;
    }
    await send('redweb:state', { name: 'markup', html: true, value: '<b data-rw-state="nested">before</b>' });
    await tab.evaluate(eventual(`Boolean(document.querySelector('[data-rw-state="nested"]'))`, 'HTML state'));
    await send('redweb:state', { name: 'nested', value: 'after' });
    await tab.evaluate(eventual(`document.querySelector('[data-rw-state="nested"]').textContent === 'after'`, 'HTML target reindex'));
    assertions++;
    await check(`(() => { const values = runtimeTest.formValues(document.getElementById('ordinary')); return Object.getPrototypeOf(values) === null && JSON.stringify(values.same) === '["a","b","c"]' && values.__proto__ === 'safe'; })()`, 'repeated/prototype-named fields are data');
    await tab.evaluate(`(() => {
        document.getElementById('ordinary').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        document.querySelector('#runtime-fixture p').click();
    })()`);
    await tab.evaluate(`(() => {
        runtimeErrors.length = 0;
        document.getElementById('runtime-fixture').append(document.createComment('rw:cdead'));
    })()`);
    await send('redweb:patch', { patches: [{ id: 'cdead', html: '<p>missing boundary</p>' }], states: [] });
    // A malformed patch exercises the production listener's error reporting.
    await tab.evaluate(eventual(`runtimeErrors.includes('Missing Redweb component boundary.')`, 'malformed patch error'));
    await check(`runtimeErrors.length === 1`, 'malformed patch reports its specific error exactly once');
    await tab.evaluate(`document.querySelector('#runtime-fixture > input').select()`);
    await tab.command('Input.insertText', { text: 'typed on browser' });
    await waitForCondition(() => control.page.label === 'typed on browser', 'native text input reached server state');
    await tab.evaluate(eventual(`document.querySelector('#runtime-fixture > p').textContent === 'typed on browser'`, 'server echo of text state'));
    assertions++;
    await tab.evaluate(`document.querySelector('#runtime-fixture [type="checkbox"]').focus()`);
    for (const type of ['keyDown', 'keyUp']) await tab.command('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await waitForCondition(() => control.page.checked === true, 'native checkbox input reached server state');
    assertions++;
    await tab.evaluate(`(() => {
        runtimeTest.client.close();
        runtimeErrors.length = 0;
        const input = document.querySelector('#runtime-fixture > input');
        input.value = 'offline draft';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await check(`runtimeErrors.length === 1 && runtimeErrors[0] === 'WebSocket is not open.' && document.querySelector('#runtime-fixture > input').value === 'offline draft'`, 'offline state send reports failure and preserves draft');
    assert.equal(control.page.label, 'typed on browser', 'offline edit did not reach server');
    assertions++;
    await tab.evaluate(`runtimeTest.client.connect().then(() => true)`);
    // A real ordered action/result round trip is the barrier after reconnect;
    // merely checking before the socket opens would miss an offline replay.
    await tab.evaluate(`(() => {
        window.reconnectedAction = null;
        runtimeTest.client.request('redweb:html', { kind: 'action', component: 'first', name: 'click', args: [] }).then(
            () => { window.reconnectedAction = { ok: true }; },
            error => { window.reconnectedAction = { ok: false, error: error.message }; });
    })()`);
    await finish('click');
    await tab.evaluate(eventual(`window.reconnectedAction !== null`, 'post-reconnect ordered action'));
    assert.deepEqual(await tab.evaluate('window.reconnectedAction'), { ok: true });
    assert.equal(control.page.label, 'typed on browser', 'offline state was not replayed after a post-reconnect action');
    assertions++;
    return { assertions };
}

module.exports = { verifyRuntimeBrowser };
