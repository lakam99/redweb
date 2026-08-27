function browserRuntime(clientPath) {
    return `import { RedwebClient } from ${JSON.stringify(clientPath)};

const configNode = document.getElementById('__redweb_page');
const config = JSON.parse(configNode.textContent);
const client = new RedwebClient(config.socketPath + '?pageId=' + encodeURIComponent(config.pageId), {
    baseUrl: window.location.href,
    version: config.version,
    reconnect: { enabled: true, maxAttempts: 8 },
    maxQueueSize: 32
});

const emit = (type, detail) => document.dispatchEvent(new CustomEvent(type, { detail }));
let stateTargets = new Map();
const indexState = () => {
    stateTargets = new Map();
    document.querySelectorAll('[data-rw-state]').forEach(node => {
        const name = node.getAttribute('data-rw-state');
        const targets = stateTargets.get(name) || [];
        targets.push(node);
        stateTargets.set(name, targets);
    });
};
const named = (attribute, name) => attribute === 'data-rw-state'
    ? (stateTargets.get(name) || [])
    : [...document.querySelectorAll('[' + attribute + ']')].filter(node => node.getAttribute(attribute) === name);
indexState();

client.on('redweb:state', message => {
    const update = message.payload;
    named('data-rw-state', update.name).forEach(node => {
        if (update.html) {
            node.innerHTML = update.value;
            indexState();
        }
        else node.textContent = update.value;
    });
    named('rw-bind', update.name).forEach(node => {
        if (node.type === 'checkbox') node.checked = update.value === true || update.value === 'true';
        else if (node.value !== update.value) node.value = update.value;
    });
});

const report = error => emit('redweb:error', error);
const send = payload => {
    try { client.send('redweb:html', payload); }
    catch (error) { report(error); }
};
const formValues = form => {
    const values = {};
    for (const [name, value] of new FormData(form)) {
        if (!(name in values)) values[name] = value;
        else values[name] = Array.isArray(values[name]) ? [...values[name], value] : [values[name], value];
    }
    return values;
};

document.addEventListener('click', event => {
    const target = event.target.closest('[rw-click]');
    if (!target) return;
    event.preventDefault();
    client.request('redweb:html', { kind: 'action', name: target.getAttribute('rw-click'), args: [] }).catch(report);
});

document.addEventListener('submit', event => {
    const form = event.target.closest('form[rw-submit]');
    if (!form) return;
    event.preventDefault();
    client.request('redweb:html', {
        kind: 'action', name: form.getAttribute('rw-submit'), args: [formValues(form)]
    }).then(() => form.reset()).catch(report);
});

document.addEventListener('input', event => {
    const target = event.target.closest('[rw-bind]');
    if (target) send({
        kind: 'state',
        name: target.getAttribute('rw-bind'),
        value: target.type === 'checkbox' ? target.checked : target.value
    });
});

client.onError(report);
client.onStateChange(state => emit('redweb:connection', state));
client.connect().catch(report);
`;
}

module.exports = browserRuntime;
