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

function assertTextContext(source) {
    const lastOpen = source.lastIndexOf('<');
    const lastClose = source.lastIndexOf('>');
    if (lastOpen > lastClose) throw new TypeError('html interpolations are only allowed in element text.');
    const withoutClosedRawText = source.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    if (/<(script|style)\b[^>]*>[\s\S]*$/i.test(withoutClosedRawText)) {
        throw new TypeError('html interpolations are not allowed in script or style content.');
    }
}

function html(strings, ...values) {
    if (!Array.isArray(strings) || !Object.prototype.hasOwnProperty.call(strings, 'raw')) {
        throw new TypeError('html must be used as a tagged template literal.');
    }
    const rendered = strings.reduce((result, part, index) => {
        const next = result + part;
        if (index >= values.length) return next;
        assertTextContext(next);
        return next + renderValue(values[index]);
    }, '');
    return Object.freeze({ [HTML_FRAGMENT]: true, toString: () => rendered });
}

module.exports = { assertTextContext, escapeHtml, html, isHtml, renderValue };
