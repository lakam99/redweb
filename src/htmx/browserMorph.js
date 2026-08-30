// Kept as a browser module source like browserRuntime; exercised in the real-browser gate.
function browserMorph() {
    return `
const clientNodes = new WeakSet();
const marker = node => node?.nodeType === 8 && /^rw:[ck][0-9a-f]*$/.test(node.data) ? node.data : null;
const units = (parent, start = null, end = null) => {
    const result = [];
    const keys = new Set();
    let node = start ? start.nextSibling : parent.firstChild;
    while (node && node !== end) {
        if (clientNodes.has(node)) { node = node.nextSibling; continue; }
        const key = marker(node);
        let last = node;
        if (key) {
            if (key.startsWith('rw:k') && keys.has(key)) throw new Error('Duplicate JSX sibling key.');
            keys.add(key);
            while (last && last !== end && !(last.nodeType === 8 && last.data === '/' + key)) last = last.nextSibling;
            if (!last || last === end) throw new Error('Incomplete Redweb render boundary.');
        }
        result.push({ first: node, last, key });
        node = last.nextSibling;
    }
    return result;
};
const matchKey = unit => unit.key || [unit.first.nodeType, unit.first.nodeName, unit.first.namespaceURI, unit.first.id || ''].join(':');
const rangeNodes = unit => {
    const nodes = [];
    for (let node = unit.first; node; node = node.nextSibling) {
        nodes.push(node);
        if (node === unit.last) break;
    }
    return nodes;
};
const optionDefaults = node => {
    const seen = new Map();
    return [...node.options].map(option => {
        const occurrence = seen.get(option.value) || 0;
        seen.set(option.value, occurrence + 1);
        return { option, value: option.value, selected: option.defaultSelected, key: JSON.stringify([option.value, option.id || occurrence]) };
    });
};
const defaultsChanged = (previous, node) => {
    const original = new Map(previous.map(entry => [entry.option, entry]));
    const pending = new Map();
    const count = (key, change) => pending.set(key, (pending.get(key) || 0) + change);
    for (const entry of previous) if (entry.selected) count(entry.key, 1);
    for (const entry of optionDefaults(node)) {
        const before = original.get(entry.option);
        if (before && before.value === entry.value) {
            if (before.selected !== entry.selected) return true;
            if (entry.selected) count(before.key, -1);
        } else if (entry.selected) count(entry.key, -1);
    }
    return [...pending.values()].some(value => value !== 0);
};
const restoreSelection = (node, incoming, previous, resetToDefaults) => {
    const options = [...node.options];
    const selected = new Set();
    if (resetToDefaults) {
        [...incoming.options].forEach((option, index) => { if (option.selected) selected.add(options[index]); });
    } else {
        const available = new Set(options);
        const missing = new Map();
        for (const entry of previous) {
            if (available.has(entry.option) && entry.option.value === entry.value) selected.add(entry.option);
            else missing.set(entry.value, (missing.get(entry.value) || 0) + 1);
        }
        // Retained identities win; only replaced options need value matching.
        // Consume each missing value once, even when option values are repeated.
        for (const option of options) {
            const count = missing.get(option.value) || 0;
            if (count && !selected.has(option)) {
                selected.add(option);
                missing.set(option.value, count - 1);
            }
        }
    }
    if (resetToDefaults || selected.size || !previous.length) {
        for (const option of options) option.selected = selected.has(option);
    }
};
const morphNode = (node, incoming) => {
    if (node.nodeType !== 1) {
        if (node.nodeValue !== incoming.nodeValue) node.nodeValue = incoming.nodeValue;
        return;
    }
    const input = node.localName === 'input';
    const textarea = node.localName === 'textarea';
    const select = node.localName === 'select';
    const previousValue = node.value;
    const previousChecked = node.checked;
    const valueChanged = input ? node.getAttribute('value') !== incoming.getAttribute('value') :
        textarea && node.defaultValue !== incoming.defaultValue;
    const checkedChanged = input && node.hasAttribute('checked') !== incoming.hasAttribute('checked');
    const selections = select ? [...node.selectedOptions].map(option => ({ option, value: option.value })) : [];
    const defaults = select ? optionDefaults(node) : null;
    for (const attribute of [...node.attributes]) if (!incoming.hasAttribute(attribute.name)) node.removeAttribute(attribute.name);
    for (const attribute of incoming.attributes) if (node.getAttribute(attribute.name) !== attribute.value) node.setAttribute(attribute.name, attribute.value);
    reconcile(node, incoming);
    if ((input && node.type !== 'file') || textarea) node.value = valueChanged ? incoming.value : previousValue;
    if (input) node.checked = checkedChanged ? incoming.checked : previousChecked;
    if (select) restoreSelection(node, incoming, selections, defaultsChanged(defaults, node));
};
const reconcile = (parent, incoming, start = null, end = null, incomingStart = null, incomingEnd = null) => {
    const previous = units(parent, start, end);
    const desired = units(incoming, incomingStart, incomingEnd);
    const remaining = new Set(previous);
    const candidates = new Map();
    for (const unit of previous) {
        const key = matchKey(unit);
        const matches = candidates.get(key) || { units: [], next: 0 };
        matches.units.push(unit);
        candidates.set(key, matches);
    }
    let cursor = start ? start.nextSibling : parent.firstChild;
    // A bounded cursor cannot pass its retained end marker; unbounded null appends.
    for (const wanted of desired) {
        const matches = candidates.get(matchKey(wanted));
        const found = matches?.units[matches.next++];
        if (!found) {
            for (const node of rangeNodes(wanted)) parent.insertBefore(node.cloneNode(true), cursor);
            continue;
        }
        remaining.delete(found);
        if (found.first !== cursor) for (const node of rangeNodes(found)) parent.insertBefore(node, cursor);
        if (found.key) reconcile(parent, incoming, found.first, found.last, wanted.first, wanted.last);
        else morphNode(found.first, wanted.first);
        cursor = found.last.nextSibling;
    }
    for (const unit of remaining) for (const node of rangeNodes(unit)) node.remove();
};
const preserveFocus = update => {
    const active = document.activeElement;
    const selection = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null;
    update();
    if (active?.isConnected && document.activeElement !== active) active.focus({ preventScroll: true });
    if (active?.isConnected && selection && typeof active.selectionStart === 'number') active.setSelectionRange(...selection);
};
const morphContent = (node, html) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    reconcile(node, range.createContextualFragment(html));
};
const applyPatch = patch => {
    if (patch.id === 'root') {
        const incoming = new DOMParser().parseFromString(patch.html, 'text/html');
        morphNode(document.documentElement, incoming.documentElement);
        return;
    }
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
    const starts = [];
    while (walker.nextNode()) if (walker.currentNode.data === 'rw:' + patch.id) starts.push(walker.currentNode);
    for (const start of starts) {
        let end = start.nextSibling;
        while (end && !(end.nodeType === 8 && end.data === '/rw:' + patch.id)) end = end.nextSibling;
        if (!end) throw new Error('Missing Redweb component boundary.');
        const range = document.createRange();
        range.setStartAfter(start);
        range.setEndBefore(end);
        reconcile(start.parentNode, range.createContextualFragment(patch.html), start, end);
    }
};
`;
}

module.exports = browserMorph;
