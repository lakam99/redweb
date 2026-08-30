const assert = require('assert/strict');
const { start } = require('../..');
const { createFeedbackPage } = require('../../tests/fixtures/feedback-page');
const { waitForCondition, waitForListening, silentLogger, withTimeout } = require('../../tests/helpers/network');

async function verifyActionFeedback({ openPage, debugPort, pages, eventual, serverOptions = {}, afterChecks, onServer }) {
    const waits = new Map();
    const control = {
        forms: new Map(),
        wait(message) { return new Promise((resolve, reject) => waits.set(message, { resolve, reject })); },
    };
    const server = start(createFeedbackPage(control), { ...serverOptions, port: 0, bind: '127.0.0.1', logger: silentLogger });
    const finish = async message => {
        await waitForCondition(() => waits.has(message), `action ${message} entered`);
        waits.get(message).resolve();
        waits.delete(message);
    };
    let failure;
    try {
        if (onServer) onServer(server);
        await waitForListening(server.server);
        const browser = await openPage(debugPort, `http://127.0.0.1:${server.server.address().port}/`);
        pages.push(browser);
        const submit = (id, value) => browser.evaluate(`(() => {
            const form = document.getElementById(${JSON.stringify(id)});
            form.elements.message.value = ${JSON.stringify(value)};
            form.requestSubmit();
        })()`);
        const status = (id, value) => browser.evaluate(eventual(`document.getElementById(${JSON.stringify(id)}).getAttribute('data-rw-status') === ${JSON.stringify(value)}`, `${id} ${value}`));

        await submit('first', 'original');
        await browser.evaluate(`document.getElementById('first').requestSubmit()`);
        await status('first', 'pending');
        await waitForCondition(() => waits.has('original'), 'first action entered');
        assert.equal(control.forms.get('first').calls, 1, 'Repeated submit must not run twice.');
        assert.equal(await browser.evaluate(`document.querySelector('#first [data-rw-feedback]').getAttribute('role')`), 'status');
        await browser.evaluate(`(() => {
            const input = document.querySelector('#first input');
            input.value = 'new draft'; input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus(); input.setSelectionRange(1, 4);
        })()`);
        control.page.tick += 1;
        await browser.evaluate(eventual(`document.getElementById('tick').textContent === '1'`, 'pending server patch'));
        await status('first', 'pending');
        assert.equal(await browser.evaluate(`document.querySelectorAll('#first [data-rw-feedback]').length`), 1);
        await finish('original');
        await status('first', 'success');
        assert.equal(await browser.evaluate(`document.querySelector('#first input').value`), 'new draft');
        assert.equal(await browser.evaluate(`document.activeElement === document.querySelector('#first input') && document.activeElement.selectionStart === 1`), true);

        await submit('first', 'unchanged');
        await finish('unchanged');
        await status('first', 'success');
        assert.equal(await browser.evaluate(`document.querySelector('#first input').value`), '');
        assert.equal(await browser.evaluate(`document.querySelectorAll('#first [data-rw-feedback]').length`), 1, 'Status nodes must be reused.');
        await submit('first', 'programmatic');
        await status('first', 'pending');
        await browser.evaluate(`document.querySelector('#first input').value = 'script draft'`);
        await finish('programmatic');
        await status('first', 'success');
        assert.equal(await browser.evaluate(`document.querySelector('#first input').value`), 'script draft');
        await submit('first', 'revised back');
        await status('first', 'pending');
        await browser.evaluate(`document.querySelector('#first input').dispatchEvent(new Event('input', { bubbles: true }))`);
        await finish('revised back');
        await status('first', 'success');
        assert.equal(await browser.evaluate(`document.querySelector('#first input').value`), 'revised back');
        await submit('first', '');
        await status('first', 'error');
        assert.equal(await browser.evaluate(`document.querySelector('#first [data-rw-feedback]').textContent`), 'Check the form values and try again.');

        const callsBeforeDenials = control.forms.get('first').calls;
        for (const [value, message] of [
            ['denied', 'You do not have permission to perform this action.'],
            ['policy timeout', 'Authorization timed out. The action was not run.'],
        ]) {
            await submit('first', value);
            await status('first', 'error');
            assert.equal(await browser.evaluate(`document.querySelector('#first [data-rw-feedback]').textContent`), message);
            assert.equal(await browser.evaluate(`document.querySelector('#first input').value`), value, 'Permission failures must preserve the draft.');
            assert.equal(control.forms.get('first').calls, callsBeforeDenials);
        }
        await submit('first', 'permitted');
        await finish('permitted');
        await status('first', 'success');

        await submit('second', 'second');
        await submit('nested', 'nested');
        await status('second', 'pending');
        await status('nested', 'pending');
        assert.equal(await browser.evaluate(`document.getElementById('second-status').getAttribute('data-rw-component')`), 'second');
        assert.equal(await browser.evaluate(`document.getElementById('nested-status').getAttribute('data-rw-component')`), 'group.nested');
        await finish('second');
        await status('second', 'success');
        await status('nested', 'pending');
        await finish('nested');
        await status('nested', 'success');
        assert.equal(await browser.evaluate(`document.getElementById('nested-status').getAttribute('aria-live')`), 'assertive');
        assert.equal(await browser.evaluate(`document.querySelectorAll('#second [data-rw-feedback]').length`), 0);

        await submit('second', 'slot replacement');
        await status('second', 'pending');
        await browser.evaluate(`window.oldStatus = document.getElementById('second-status')`);
        control.forms.get('second').slotVersion += 1;
        await browser.evaluate(eventual(`document.getElementById('second-status') !== oldStatus && document.getElementById('second-status').textContent === 'Working…'`, 'replacement status slot'));
        await finish('slot replacement');
        await status('second', 'success');
        assert.equal(await browser.evaluate(`document.getElementById('second-status').textContent`), 'Done.');

        await submit('second', 'old source');
        await status('second', 'pending');
        control.forms.get('second').visible = false;
        await browser.evaluate(eventual(`!document.getElementById('second') && document.getElementById('second-status').textContent === '' && !document.getElementById('second-status').hasAttribute('data-rw-status')`, 'removed source slot cleanup'));
        control.forms.get('second').visible = true;
        await browser.evaluate(eventual(`Boolean(document.getElementById('second'))`, 'new source'));
        await submit('second', 'new source');
        await finish('old source');
        await waitForCondition(() => waits.has('new source'), 'new source entered');
        assert.equal(await browser.evaluate(`document.getElementById('second-status').textContent`), 'Working…', 'Old completion must not clear a newer owner.');
        await finish('new source');
        await status('second', 'success');

        await browser.evaluate(`document.querySelector('#first [rw-click]').click()`);
        await browser.evaluate(eventual(`document.querySelector('#first [rw-click]').getAttribute('data-rw-status') === 'pending'`, 'click feedback'));
        await finish('click');
        await browser.evaluate(eventual(`document.querySelector('#first [rw-click]').getAttribute('data-rw-status') === 'success'`, 'click completion'));

        await submit('first', 'removed');
        await status('first', 'pending');
        control.page.version += 1;
        await browser.evaluate(eventual(`!document.getElementById('first').hasAttribute('data-rw-status')`, 'source replacement'));
        await browser.evaluate(`document.querySelector('#first input').value = 'replacement draft'`);
        const afterRemoved = control.forms.get('first').completed + 1;
        await finish('removed');
        await browser.evaluate(eventual(`document.querySelector('#first output').textContent === '${afterRemoved}'`, 'old action completed on server'));
        assert.equal(await browser.evaluate(`document.querySelector('#first input').value`), 'replacement draft');
        assert.equal(await browser.evaluate(`document.getElementById('first').hasAttribute('data-rw-status')`), false, 'Old completion must not target a replacement.');

        await submit('first', 'failure');
        await status('first', 'pending');
        await waitForCondition(() => waits.has('failure'), 'failing action entered');
        waits.get('failure').reject(new Error('<script>private application detail</script>'));
        waits.delete('failure');
        await status('first', 'error');
        assert.equal(await browser.evaluate(`document.querySelector('#first [data-rw-feedback]').textContent`), 'The action could not be confirmed. Check before trying again.');
        assert.equal(await browser.evaluate(`document.querySelector('#first input').value`), 'failure');
        await browser.evaluate(eventual(`document.documentElement.getAttribute('data-rw-connection') === 'open'`, 'reconnect after application failure'));
        await submit('first', 'recovered');
        await finish('recovered');
        await status('first', 'success');
        assert.equal(await browser.evaluate(`document.getElementById('first').getAttribute('aria-label')`), 'Authored label');

        const beforeCapacity = control.forms.get('first').calls;
        const afterCapacity = control.forms.get('first').completed + 32;
        await browser.evaluate(`(() => {
            const form = document.getElementById('first');
            for (let i = 0; i < 33; i++) {
                const button = document.createElement('button');
                button.type = 'button'; button.setAttribute('rw-click', 'click'); button.setAttribute('data-extra', i);
                form.append(button); button.click();
            }
        })()`);
        assert.equal(await browser.evaluate(`document.querySelector('[data-extra="32"]').getAttribute('data-rw-status')`), 'error');
        assert.equal(await browser.evaluate(`document.querySelector('[data-extra="32"]').nextElementSibling.textContent.includes('not sent')`), true);
        for (let i = 0; i < 32; i++) await finish('click');
        await browser.evaluate(eventual(`document.querySelector('#first output').textContent === '${afterCapacity}'`, 'capacity drain'));
        assert.equal(control.forms.get('first').calls, beforeCapacity + 32);
        assert.equal(await browser.evaluate(`document.querySelectorAll('#first [data-rw-feedback]').length`), 1, 'Removed controls must not leave orphaned statuses.');

        await browser.command('Network.enable');
        await browser.command('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
        [...server.manager.active.values()][0].socket.terminate();
        await browser.evaluate(eventual(`document.documentElement.getAttribute('data-rw-connection') !== 'open'`, 'real socket disconnect'));
        await submit('first', 'offline draft');
        await status('first', 'error');
        assert.equal(await browser.evaluate(`document.querySelector('#first > [data-rw-feedback]:last-child').textContent`), 'Not connected. The action was not sent.');
        await browser.command('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        await browser.evaluate(eventual(`document.documentElement.getAttribute('data-rw-connection') === 'open'`, 'reconnected socket'));
        assert.equal(await browser.evaluate(`document.querySelector('#first input').value`), 'offline draft');
        await submit('first', 'online again');
        await finish('online again');
        await status('first', 'success');
        assert.equal(waits.has('offline draft'), false, 'Disconnected actions must never replay after reconnect.');
        if (afterChecks) await afterChecks(browser);
    } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error), { cause: error });
    } finally {
        waits.forEach(wait => wait.resolve());
        try { await withTimeout(server.shutdown(), 'action feedback server shutdown', 15000); }
        catch (cleanup) {
            failure = failure ? new AggregateError([failure, cleanup], failure.message, { cause: failure }) : cleanup;
        }
    }
    if (failure) throw failure;
}

module.exports = { verifyActionFeedback };
