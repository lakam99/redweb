const browserMorph = require('./browserMorph');
const browserFeedback = require('./browserFeedback');

function browserRuntime(clientPath) {
    return `import { RedwebClient } from ${JSON.stringify(clientPath)};

const configNode = document.getElementById('__redweb_page');
const config = JSON.parse(configNode.textContent);
${browserMorph()}
const client = new RedwebClient(config.socketPath + '?pageId=' + encodeURIComponent(config.pageId), {
    baseUrl: window.location.href,
    version: config.version,
    reconnect: { enabled: true, maxAttempts: 8 },
    maxQueueSize: 0
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
client.on('redweb:state', message => preserveFocus(() => {
    applyState(message.payload);
    refreshFeedback();
}));
client.on('redweb:patch', message => {
    try {
        preserveFocus(() => {
            message.payload.patches.forEach(applyPatch);
            indexState();
            message.payload.states.forEach(applyState);
            refreshFeedback();
        });
    } catch (error) { report(error); }
});

const report = error => emit('redweb:error', error);
${browserFeedback()}
const send = payload => {
    try { client.send('redweb:html', payload); }
    catch (error) { report(error); }
};
const formValues = form => {
    const values = Object.create(null);
    for (const [name, value] of new FormData(form)) {
        if (!Object.hasOwn(values, name)) values[name] = value;
        else values[name] = Array.isArray(values[name]) ? [...values[name], value] : [values[name], value];
    }
    return values;
};

document.addEventListener('click', event => {
    const target = event.target.closest('[rw-click]');
    if (!target) return;
    event.preventDefault();
    performAction(target, {
        kind: 'action', name: target.getAttribute('rw-click'), component: componentOf(target), args: []
    }).catch(report);
});

document.addEventListener('submit', event => {
    const form = event.target.closest('form[rw-submit]');
    if (!form) return;
    event.preventDefault();
    const values = formValues(form);
    const revision = revisions.get(form) || 0;
    const binding = bindingOf(form);
    performAction(form, {
        kind: 'action', name: form.getAttribute('rw-submit'), component: componentOf(form), args: [values]
    }, () => {
        if (form.isConnected && bindingOf(form) === binding && (revisions.get(form) || 0) === revision && JSON.stringify(formValues(form)) === JSON.stringify(values)) {
            HTMLFormElement.prototype.reset.call(form);
        }
    }).catch(report);
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
client.onStateChange(state => {
    document.documentElement.setAttribute('data-rw-connection', state);
    emit('redweb:connection', state);
});
client.connect().catch(report);
`;
}

module.exports = browserRuntime;
