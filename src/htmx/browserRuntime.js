const browserMorph = require('./browserMorph');

function browserRuntime(clientPath) {
    return `import { RedwebClient } from ${JSON.stringify(clientPath)};

const configNode = document.getElementById('__redweb_page');
const config = JSON.parse(configNode.textContent);
${browserMorph()}
const client = new RedwebClient(config.socketPath + '?pageId=' + encodeURIComponent(config.pageId), {
    baseUrl: window.location.href,
    version: config.version,
    reconnect: { enabled: true, maxAttempts: 8 },
    maxQueueSize: 32
});

const emit = (type, detail) => document.dispatchEvent(new CustomEvent(type, { detail }));
let stateTargets = new Map();
const componentOf = node => node.closest('[data-rw-component]')?.getAttribute('data-rw-component') || null;
const stateKey = (component, name) => (component || '') + '\\0' + name;
const indexState = () => {
    stateTargets = new Map();
    document.querySelectorAll('[data-rw-state]').forEach(node => {
        const name = node.getAttribute('data-rw-state');
        const key = stateKey(componentOf(node), name);
        const targets = stateTargets.get(key) || [];
        targets.push(node);
        stateTargets.set(key, targets);
    });
};
const named = (attribute, name, component) => attribute === 'data-rw-state'
    ? (stateTargets.get(stateKey(component, name)) || [])
    : [...document.querySelectorAll('[' + attribute + ']')].filter(node =>
        node.getAttribute(attribute) === name && componentOf(node) === component);
indexState();

const applyState = update => {
    const component = update.component || null;
    named('data-rw-state', update.name, component).forEach(node => {
        if (update.html) {
            morphContent(node, update.value);
            indexState();
        }
        else node.textContent = update.value;
    });
    named('rw-bind', update.name, component).forEach(node => {
        if (node.type === 'checkbox') node.checked = update.value === true || update.value === 'true';
        else if (node.value !== update.value) node.value = update.value;
    });
};
client.on('redweb:state', message => preserveFocus(() => applyState(message.payload)));
client.on('redweb:patch', message => {
    try {
        preserveFocus(() => {
            message.payload.patches.forEach(applyPatch);
            indexState();
            message.payload.states.forEach(applyState);
        });
    } catch (error) { report(error); }
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
    client.request('redweb:html', {
        kind: 'action', name: target.getAttribute('rw-click'), component: componentOf(target), args: []
    }).catch(report);
});

document.addEventListener('submit', event => {
    const form = event.target.closest('form[rw-submit]');
    if (!form) return;
    event.preventDefault();
    client.request('redweb:html', {
        kind: 'action', name: form.getAttribute('rw-submit'), component: componentOf(form), args: [formValues(form)]
    }).then(() => form.reset()).catch(report);
});

document.addEventListener('input', event => {
    const target = event.target.closest('[rw-bind]');
    if (target) send({
        kind: 'state',
        name: target.getAttribute('rw-bind'),
        component: componentOf(target),
        value: target.type === 'checkbox' ? target.checked : target.value
    });
});

client.onError(report);
client.onStateChange(state => emit('redweb:connection', state));
client.connect().catch(report);
`;
}

module.exports = browserRuntime;
