'use strict';

// Runs against Chromium's real DOM. No browser API is replaced.
function runMorphCases() {
    const { units, marker, rangeNodes, morphNode, morphContent, preserveFocus, applyPatch, clientNodes } = window.morph;
    let assertions = 0;
    const check = (condition, label) => { assertions++; if (!condition) throw new Error(label); };
    const throws = (operation, message) => {
        let error;
        try { operation(); } catch (caught) { error = caught; }
        check(error && error.message.includes(message), message);
    };
    const node = markup => {
        const template = document.createElement('template');
        template.innerHTML = markup;
        return template.content.firstChild;
    };
    const fixture = markup => {
        document.body.innerHTML = '<main id="fixture"></main>';
        const root = document.getElementById('fixture');
        root.innerHTML = markup;
        return root;
    };

    check(marker(null) === null && marker(document.createTextNode('rw:c1')) === null, 'non-marker nodes');
    check(marker(document.createComment('ordinary')) === null, 'ordinary comment');
    check(marker(document.createComment('rw:c1')) === 'rw:c1', 'component marker');
    check(marker(document.createComment('rw:k12')) === 'rw:k12', 'key marker');
    let root = fixture('<!--rw:k1--><b>A</b><!--/rw:k1--><!--rw:k1--><b>B</b><!--/rw:k1-->');
    throws(() => units(root), 'Duplicate JSX sibling key');
    root = fixture('<!--rw:c1--><b>missing end</b>');
    throws(() => units(root), 'Incomplete Redweb render boundary');
    root = fixture('<!--rw:c1--><b>missing end</b><!--stop-->');
    throws(() => units(root, null, root.lastChild), 'Incomplete Redweb render boundary');
    root = fixture('<!--rw:c1--><b>A</b><!--/rw:c1--><!--rw:c1--><b>B</b><!--/rw:c1-->');
    check(units(root).length === 2, 'repeated component boundaries remain separate');
    check(rangeNodes({ first: root.firstChild, last: null }).length === 6, 'range ends at actual sibling boundary');

    root = fixture('<p id="a" title="old">old</p><p id="b">B</p><i>remove</i>');
    const original = root.firstChild;
    morphContent(root, '<p id="b">B</p><p id="a" data-next="yes">new</p><strong>added</strong>');
    check(root.children[1] === original && original.textContent === 'new', 'reorder retains identity and updates text');
    check(!original.hasAttribute('title') && original.getAttribute('data-next') === 'yes', 'attribute removal/addition');
    check(root.lastChild.localName === 'strong' && !root.querySelector('i'), 'insertion and removal');
    morphContent(root, root.innerHTML);
    check(root.children[1] === original, 'unchanged markup retains identity');

    root = fixture('<!--rw:k1--><input id="a" value="A"><!--/rw:k1--><!--rw:k2--><textarea id="b">B</textarea><!--/rw:k2-->');
    const a = root.querySelector('#a'), b = root.querySelector('#b');
    a.value = 'draft A'; b.value = 'draft B'; a.focus(); a.setSelectionRange(1, 4, 'backward');
    preserveFocus(() => morphContent(root, '<!--rw:k2--><textarea id="b">B</textarea><!--/rw:k2--><!--rw:k1--><input id="a" value="A"><!--/rw:k1-->'));
    check(root.querySelector('#a') === a && root.querySelector('#b') === b, 'keyed controls preserve identity');
    check(a.value === 'draft A' && b.value === 'draft B', 'draft values survive unchanged defaults');
    check(document.activeElement === a && a.selectionStart === 1 && a.selectionEnd === 4 && a.selectionDirection === 'backward', 'focus and selection survive moves');
    morphNode(a, node('<input id="a" value="server A" checked>'));
    morphNode(b, node('<textarea id="b">server B</textarea>'));
    check(a.value === 'server A' && a.checked && b.value === 'server B', 'server default changes take effect');
    a.checked = false;
    morphNode(a, node('<input id="a" value="server A" checked>'));
    check(!a.checked, 'client checked state survives unchanged default');
    morphNode(a, node('<input id="a" value="server A">'));
    check(!a.checked, 'removed checked default is applied');

    root = fixture('<input type="file"><select multiple><option value="a" selected>A</option><option value="b">B</option></select>');
    morphNode(root.firstChild, node('<input type="file">'));
    check(root.firstChild.value === '', 'file input stays legal');
    const select = root.querySelector('select');
    select.options[0].selected = false; select.options[1].selected = true;
    morphNode(select, node('<select multiple><option value="a" selected>A</option><option value="b">B</option></select>'));
    check(select.value === 'b', 'select draft survives unchanged defaults');
    morphNode(select, node('<select multiple><option value="a">A</option><option value="b" selected>B</option></select>'));
    check(select.value === 'b', 'changed select default is applied');
    morphNode(select, node('<select multiple><option value="c">C</option></select>'));
    check(select.selectedOptions.length === 0, 'removed selected option is not resurrected');
    const duplicate = node('<select multiple><option value="same">First</option><option value="same">Second</option><option value="other">Third</option></select>');
    root.append(duplicate);
    duplicate.options[1].selected = true;
    morphNode(duplicate, node('<select multiple><option value="same">First</option><option value="same">Second</option><option value="other">Third</option></select>'));
    check(duplicate.selectedOptions.length === 1 && duplicate.options[1].selected, 'duplicate option values preserve the selected option, not every equal value');
    const single = node('<select><option value="same">First</option><option value="same">Second</option><option value="same">Third</option></select>');
    root.append(single); single.selectedIndex = 1;
    morphNode(single, node('<select><option value="same">First</option><option value="same">Second</option><option value="same">Third</option></select>'));
    check(single.selectedIndex === 1, 'single select keeps the exact duplicate choice');
    morphNode(single, node('<select><option value="same" selected>First</option><option value="same">Second</option><option value="same">Third</option></select>'));
    check(single.selectedIndex === 0, 'duplicate default change picks the exact incoming index');
    morphNode(single, node('<select><option value="same">First</option><option value="same" selected>Second</option><option value="same">Third</option></select>'));
    check(single.selectedIndex === 1, 'moving the selected duplicate default is detected');
    const replacements = node('<select multiple><option id="old1" value="same">First</option><option id="old2" value="same">Second</option><option id="retained" value="same">Third</option></select>');
    root.append(replacements);
    for (const option of replacements.options) option.selected = true;
    const retained = replacements.options[2];
    morphNode(replacements, node('<select multiple><option id="retained" value="same">Third</option><option id="new1" value="same">New first</option><option id="new2" value="same">New second</option><option id="extra" value="same">Extra</option></select>'));
    check(replacements.selectedOptions.length === 3 && retained.selected && !replacements.options[3].selected, 'retained identity wins over repeated-value replacement fallbacks');
    morphNode(replacements, node('<select multiple><option value="different">Different</option></select>'));
    check(replacements.selectedOptions.length === 0, 'missing values do not select unrelated options');
    morphNode(replacements, node('<select multiple><option value="different">Different</option><option>New</option></select>'));
    check(replacements.selectedOptions.length === 0, 'empty multi-select stays empty');
    const defaults = node('<select multiple><option id="d1" value="same" selected>First</option><option id="d2" value="same">Second</option></select>');
    root.append(defaults); defaults.options[0].selected = false; defaults.options[1].selected = true;
    morphNode(defaults, node('<select multiple><option id="d1" value="same" selected>First</option><option id="d2" value="same">Second</option></select>'));
    check(defaults.selectedOptions.length === 1 && defaults.options[1].selected, 'identified defaults preserve the draft');
    morphNode(defaults, node('<select multiple><option id="d1" value="same">First</option><option id="d2" value="same">Second</option></select>'));
    check(defaults.selectedOptions.length === 0, 'removing all authored defaults clears selection');
    const keyed = node('<select><!--rw:k1--><option value="same" selected>A</option><!--/rw:k1--><!--rw:k2--><option value="same">B</option><!--/rw:k2--></select>');
    root.append(keyed);
    const oldDefault = keyed.options[0];
    morphNode(keyed, node('<select><!--rw:k2--><option value="same" selected>B</option><!--/rw:k2--><!--rw:k1--><option value="same">A</option><!--/rw:k1--></select>'));
    check(keyed.selectedIndex === 0 && keyed.options[1] === oldDefault && !oldDefault.selected, 'keyed duplicate reorder can change which identity is the server default');
    keyed.selectedIndex = 1;
    morphNode(keyed, node('<select><!--rw:k1--><option value="same">A</option><!--/rw:k1--><!--rw:k2--><option value="same" selected>B</option><!--/rw:k2--></select>'));
    check(keyed.options[0] === oldDefault && oldDefault.selected, 'keyed default reorder alone preserves a different dirty selection');
    const unkeyed = node('<select><option value="a" selected>A</option><option value="b">B</option></select>');
    root.append(unkeyed); unkeyed.value = 'b';
    morphNode(unkeyed, node('<select><option value="b">B</option><option value="a" selected>A</option></select>'));
    check(unkeyed.value === 'b', 'unkeyed value replacement retains a draft when authored defaults are semantically unchanged');
    preserveFocus(() => {});
    select.focus(); preserveFocus(() => {});
    preserveFocus(() => select.remove());
    check(!select.isConnected, 'removed focus target is not restored');

    root = fixture('<p>kept</p>');
    const feedback = document.createElement('span'); feedback.textContent = 'client-owned';
    clientNodes.add(feedback); root.append(feedback);
    morphContent(root, '<p>updated</p><b>new</b>');
    check(feedback.isConnected && feedback.textContent === 'client-owned', 'client-owned feedback survives reconciliation');
    const empty = document.createElement('div');
    root.append(empty); morphContent(empty, '<span>insert at end</span>');
    check(empty.firstChild.textContent === 'insert at end', 'empty parent append');

    root = fixture('<table><tbody><!--rw:c3--><tr><td>old</td></tr><!--/rw:c3--></tbody></table><select><!--rw:c4--><option>old</option><!--/rw:c4--></select><svg xmlns="http://www.w3.org/2000/svg"><circle id="circle" r="2" /></svg>');
    applyPatch({ id: 'c3', html: '<tr><td>new cell</td></tr>' });
    applyPatch({ id: 'c4', html: '<option>new option</option>' });
    check(root.querySelector('td').textContent === 'new cell' && root.querySelector('option').textContent === 'new option', 'table and select patches use their real parsing context');
    const circle = root.querySelector('circle');
    morphContent(root.querySelector('svg'), '<circle id="circle" r="4" />');
    check(root.querySelector('circle') === circle && circle.namespaceURI === 'http://www.w3.org/2000/svg' && circle.getAttribute('r') === '4', 'SVG namespace and identity');

    root = fixture('<!--rw:c1--><span>A</span><!--/rw:c1--><!--rw:c1--><span>B</span><!--/rw:c1-->');
    applyPatch({ id: 'c1', html: '<em>changed</em>' });
    check(root.querySelectorAll('em').length === 2, 'all instances of a component patch update');
    applyPatch({ id: 'unknown', html: '<b>ignored</b>' });
    check(!root.querySelector('b'), 'unknown component patch has no target');
    root.append(document.createComment('rw:c2'));
    throws(() => applyPatch({ id: 'c2', html: 'broken' }), 'Missing Redweb component boundary');

    fixture('<button id="focus">focus</button>');
    const button = document.getElementById('focus'); button.focus();
    preserveFocus(() => button.blur());
    check(document.activeElement === button, 'non-text focused control is restored');
    applyPatch({ id: 'root', html: '<!doctype html><html lang="en"><head><title>Patched</title></head><body><article>root update</article></body></html>' });
    check(document.title === 'Patched' && document.querySelector('article').textContent === 'root update', 'whole-document patch');

    const documentRoot = document.documentElement;
    documentRoot.remove();
    preserveFocus(() => {});
    document.append(documentRoot);
    check(document.documentElement === documentRoot, 'no active document element is supported');
    return { assertions };
}

module.exports = runMorphCases;
