// Kept as a browser module source like browserRuntime; exercised in the real-browser gate.
function browserMorph() {
    return `
const marker = node => node?.nodeType === 8 && /^rw:[ck][0-9a-f]*$/.test(node.data) ? node.data : null;
const units = (parent, start = null, end = null) => {
    const result = [];
    const keys = new Set();
    let node = start ? start.nextSibling : parent.firstChild;
    while (node && node !== end) {
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
const selectedDefaults = node => [...node.options].filter(option => option.defaultSelected).map(option => option.value).join('\\0');
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
    const selections = select ? [...node.selectedOptions].map(option => option.value) : [];
    const defaultsChanged = select && selectedDefaults(node) !== selectedDefaults(incoming);
    for (const attribute of [...node.attributes]) if (!incoming.hasAttribute(attribute.name)) node.removeAttribute(attribute.name);
    for (const attribute of incoming.attributes) if (node.getAttribute(attribute.name) !== attribute.value) node.setAttribute(attribute.name, attribute.value);
    reconcile(node, incoming);
    if ((input && node.type !== 'file') || textarea) node.value = valueChanged ? incoming.value : previousValue;
    if (input) node.checked = checkedChanged ? incoming.checked : previousChecked;
    const desiredSelections = select && defaultsChanged ? [...incoming.selectedOptions].map(option => option.value) : selections;
    if (select && desiredSelections.some(value => [...node.options].some(option => option.value === value))) {
        for (const option of node.options) option.selected = desiredSelections.includes(option.value);
    }
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
    for (const wanted of desired) {
        const matches = candidates.get(matchKey(wanted));
        const found = matches?.units[matches.next++];
        if (!found) {
            for (const node of rangeNodes(wanted)) parent.insertBefore(node.cloneNode(true), cursor || end);
            continue;
        }
        remaining.delete(found);
        if (found.first !== cursor) for (const node of rangeNodes(found)) parent.insertBefore(node, cursor || end);
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
