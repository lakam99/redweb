const HTML_FRAGMENT = Symbol('redweb.htmlFragment');

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function isHtml(value) {
    return Boolean(value?.[HTML_FRAGMENT]);
}

function renderValue(value) {
    return isHtml(value) ? value.toString() : escapeHtml(value);
}

function html(strings, ...values) {
    if (!Array.isArray(strings) || !Object.prototype.hasOwnProperty.call(strings, 'raw')) {
        throw new TypeError('html must be used as a tagged template literal.');
    }
    const rendered = strings.reduce(
        (result, part, index) => result + part + (index < values.length ? renderValue(values[index]) : ''),
        ''
    );
    return Object.freeze({ [HTML_FRAGMENT]: true, toString: () => rendered });
}

module.exports = { escapeHtml, html, isHtml, renderValue };
