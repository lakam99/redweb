'use strict';

function refreshBrowser() {
    return `
const source = new URL(import.meta.url);
const initialRevision = source.searchParams.get('revision');
const endpoint = new URL('./development', source);
const host = document.getElementById('__redweb_dev');
const validRevision = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
if (host && validRevision(initialRevision)) {
    const editable = target => target instanceof Element && Boolean(target.closest('input:not([type="hidden"]), textarea, select, [contenteditable]:not([contenteditable="false"])'));
    const selectionChanged = select => {
        const form = document.createElement('form');
        const baseline = select.cloneNode(true);
        baseline.removeAttribute('form');
        form.append(baseline);
        HTMLFormElement.prototype.reset.call(form);
        return [...select.options].some((option, index) => option.selected !== baseline.options[index].selected);
    };
    // A conservative guard, not an autosave or a precise unsaved-change detector.
    let edited = editable(document.activeElement) || [...document.querySelectorAll('input, textarea, select, [contenteditable]')].some(node =>
        node.isContentEditable || (node.localName === 'select' ? selectionChanged(node) :
        node.type === 'file' ? node.files.length > 0 : node.type === 'checkbox' || node.type === 'radio' ? node.checked !== node.defaultChecked :
        node.type !== 'hidden' && node.value !== node.defaultValue));
    const markEdited = event => { if (event.composedPath().some(editable)) edited = true; };
    document.addEventListener('input', markEdited, true);
    document.addEventListener('change', markEdited, true);
    const shadow = host.attachShadow({ mode: 'open' });
    let stopped = false, restartDetected = false, lifetime = 0, timer, request;
    const cleanup = () => {
        stopped = true;
        lifetime += 1;
        clearTimeout(timer);
        request?.abort();
        request = null;
        document.removeEventListener('input', markEdited, true);
        document.removeEventListener('change', markEdited, true);
    };
    const confirmReload = () => {
        const stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet';
        stylesheet.href = new URL('./development.css', source).href;
        const notice = document.createElement('aside');
        notice.setAttribute('role', 'status');
        notice.setAttribute('aria-label', 'Redweb development refresh');
        const message = document.createElement('p');
        message.textContent = 'Development server restarted. Your current document is kept because edits were detected. Reloading resets these drafts and server memory may have changed.';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Reload and discard drafts';
        button.addEventListener('click', () => location.reload());
        notice.append(message, button);
        shadow.append(stylesheet, notice);
    };
    const poll = async () => {
        if (stopped) return;
        const generation = lifetime;
        const controller = new AbortController();
        request = controller;
        const timeout = setTimeout(() => controller.abort(), 2000);
        try {
            const response = await fetch(endpoint, { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal });
            if (response.ok && response.headers.get('content-type')?.startsWith('application/json')) {
                const result = await response.json();
                if (!stopped && generation === lifetime && validRevision(result.revision) && result.revision !== initialRevision) {
                    restartDetected = true;
                    cleanup();
                    if (edited) confirmReload();
                    else location.reload();
                }
            }
        } catch { /* Outage, rebuild failure or malformed response is not a new revision. */ }
        finally {
            clearTimeout(timeout);
            if (generation === lifetime) {
                request = null;
                if (!stopped) timer = setTimeout(poll, 1000);
            }
        }
    };
    window.addEventListener('pagehide', cleanup);
    window.addEventListener('pageshow', event => {
        if (event.persisted && !restartDetected) {
            stopped = false;
            document.addEventListener('input', markEdited, true);
            document.addEventListener('change', markEdited, true);
            poll();
        }
    });
    poll();
}
`;
}

module.exports = refreshBrowser;
