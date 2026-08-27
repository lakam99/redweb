function browserRuntime(clientPath) {
    return `import { RedwebClient } from ${JSON.stringify(clientPath)};

const configNode = document.getElementById('__redweb_page');
const config = JSON.parse(configNode.textContent);
const client = new RedwebClient(config.socketPath + '?pageId=' + encodeURIComponent(config.pageId), {
    baseUrl: window.location.href,
    version: config.version,
    reconnect: { enabled: true, maxAttempts: 8 }
});

const named = (attribute, name) => [...document.querySelectorAll('[' + attribute + ']')]
    .filter(node => node.getAttribute(attribute) === name);

client.on('redweb:state', message => {
    const update = message.payload;
    named('data-rw-state', update.name).forEach(node => {
        if (update.html) node.innerHTML = update.value;
        else node.textContent = update.value;
    });
    named('rw-bind', update.name).forEach(node => {
        if (node.value !== update.value) node.value = update.value;
    });
});

const send = payload => client.send('redweb:html', payload);

document.addEventListener('click', event => {
    const target = event.target.closest('[rw-click]');
    if (target) send({ kind: 'action', name: target.getAttribute('rw-click'), args: [] });
});

document.addEventListener('submit', event => {
    const form = event.target.closest('form[rw-submit]');
    if (!form) return;
    event.preventDefault();
    send({ kind: 'action', name: form.getAttribute('rw-submit'), args: [Object.fromEntries(new FormData(form))] });
    form.reset();
});

document.addEventListener('input', event => {
    const target = event.target.closest('[rw-bind]');
    if (target) send({ kind: 'state', name: target.getAttribute('rw-bind'), value: target.value });
});

client.connect().catch(error => console.error('Redweb Live HTML connection failed:', error));
`;
}

module.exports = browserRuntime;
