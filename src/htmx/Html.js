const HTML_FRAGMENT = Symbol('redweb.htmlFragment');
const HTML_ATTRIBUTE = Symbol('redweb.htmlAttribute');
const HTML_URL = Symbol('redweb.htmlUrl');
const URL_ATTRIBUTES = new Set(['action', 'background', 'cite', 'data', 'formaction', 'href', 'manifest', 'ping', 'poster', 'src', 'xlink:href']);
const FORBIDDEN_ATTRIBUTES = new Set(['srcdoc', 'srcset', 'style']);

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function isHtml(value) {
    if (Array.isArray(value)) return value.every(isHtml);
    return Boolean(value?.[HTML_FRAGMENT]);
}

function trustedValue(brand, value) {
    return Object.freeze({ [brand]: true, value: String(value) });
}

function attribute(value) {
    if (!['string', 'number', 'bigint', 'boolean'].includes(typeof value)) {
        throw new TypeError('attribute() requires a string, number, bigint, or boolean.');
    }
    return trustedValue(HTML_ATTRIBUTE, value);
}

function safeUrl(value) {
    if (typeof value !== 'string' || !value || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
        throw new TypeError('url() requires a non-empty URL without surrounding whitespace or control characters.');
    }
    if (value.startsWith('//') || value.includes('\\')) throw new TypeError('url() does not allow protocol-relative or backslash URLs.');
    const protocol = /^[A-Za-z][A-Za-z0-9+.-]*:/.exec(value)?.[0].toLowerCase();
    if (protocol && !['http:', 'https:', 'mailto:', 'tel:'].includes(protocol)) {
        throw new TypeError(`url() does not allow the ${protocol} protocol.`);
    }
    return trustedValue(HTML_URL, value);
}

function renderValue(value) {
    if (Array.isArray(value)) {
        if (!isHtml(value)) throw new TypeError('Only arrays of HtmlFragment values can be rendered as HTML.');
        return value.map(renderValue).join('');
    }
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

function attributeContext(source) {
    const lastOpen = source.lastIndexOf('<');
    const lastClose = source.lastIndexOf('>');
    if (lastOpen <= lastClose) return null;
    const tag = source.slice(lastOpen);
    if (!/^<[A-Za-z]/.test(tag)) return null;
    const match = /([A-Za-z_:][\w:.-]*)[ \t\n\f\r]*=[ \t\n\f\r]*(["'])[^"']*$/.exec(tag);
    return match ? match[1].toLowerCase() : null;
}

function renderInterpolation(source, value) {
    const name = attributeContext(source);
    if (name) {
        if (name.startsWith('on') || FORBIDDEN_ATTRIBUTES.has(name)) {
            throw new TypeError(`Dynamic ${name} attributes are not allowed.`);
        }
        if (URL_ATTRIBUTES.has(name)) {
            if (!value?.[HTML_URL]) throw new TypeError(`The ${name} attribute requires url().`);
        } else if (!value?.[HTML_ATTRIBUTE]) {
            throw new TypeError(`The ${name} attribute requires attribute().`);
        }
        return escapeHtml(value.value);
    }
    assertTextContext(source);
    if (value?.[HTML_ATTRIBUTE] || value?.[HTML_URL]) {
        throw new TypeError('attribute() and url() values may only be used in matching quoted attributes.');
    }
    return renderValue(value);
}

function html(strings, ...values) {
    if (!Array.isArray(strings) || !Object.prototype.hasOwnProperty.call(strings, 'raw')) {
        throw new TypeError('html must be used as a tagged template literal.');
    }
    const rendered = strings.reduce((result, part, index) => {
        const next = result + part;
        if (index >= values.length) return next;
        return next + renderInterpolation(next, values[index]);
    }, '');
    return Object.freeze({ [HTML_FRAGMENT]: true, toString: () => rendered });
}

function each(items, render) {
    if (!Array.isArray(items)) throw new TypeError('each() requires an array.');
    if (typeof render !== 'function') throw new TypeError('each() requires a render function.');
    const fragments = items.map((item, index) => render(item, index));
    if (!fragments.every(isHtml)) throw new TypeError('each() render functions must return html fragments.');
    return Object.freeze({ [HTML_FRAGMENT]: true, toString: () => fragments.map(renderValue).join('') });
}

function codeBlock(code, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError('codeBlock() options must be an object.');
    }
    const { language = 'text', label = language } = options;
    if (typeof language !== 'string' || !/^[A-Za-z0-9_+-]{1,32}$/.test(language)) {
        throw new TypeError('codeBlock() language must be a safe name of at most 32 characters.');
    }
    if (typeof label !== 'string') throw new TypeError('codeBlock() label must be a string.');
    const caption = label ? html`<figcaption>${label}</figcaption>` : html``;
    const content = isHtml(code) ? code : String(code ?? '');
    return html`<figure class="redweb-code">${caption}<pre><code class="${attribute(`language-${language}`)}">${content}</code></pre></figure>`;
}

module.exports = { assertTextContext, attribute, codeBlock, each, escapeHtml, html, isHtml, renderValue, safeUrl };
