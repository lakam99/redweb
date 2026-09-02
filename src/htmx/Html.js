const HTML_FRAGMENT = Symbol('redweb.htmlFragment');
const HTML_ATTRIBUTE = Symbol('redweb.htmlAttribute');
const HTML_URL = Symbol('redweb.htmlUrl');
const HTML_RENDERERS = new WeakMap();
const URL_ATTRIBUTES = new Set(['action', 'background', 'cite', 'data', 'formaction', 'href', 'manifest', 'ping', 'poster', 'src', 'xlink:href']);
const FORBIDDEN_ATTRIBUTES = new Set(['srcdoc', 'srcset', 'style']);
const { interpolationContext } = require('./HtmlSyntax');
const synchronous = require('./synchronous');

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
    return Boolean(value?.[HTML_FRAGMENT]) || Boolean(value && typeof value === 'object' && HTML_RENDERERS.has(value));
}

function markHtml(value, toString) {
    HTML_RENDERERS.set(value, toString);
    return value;
}

function trustedHtml(value) {
    const rendered = String(value);
    const fragment = { toString: () => rendered };
    markHtml(fragment, fragment.toString);
    return Object.freeze(fragment);
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
    if (HTML_RENDERERS.has(value)) return HTML_RENDERERS.get(value).call(value);
    return isHtml(value) ? value.toString() : escapeHtml(value);
}

function renderInterpolation(source, value) {
    const context = interpolationContext(source);
    if (context.kind === 'attribute') {
        return renderAttributeValue(context.name, value);
    }
    if (context.kind !== 'text') throw new TypeError('html interpolations are only allowed in element text.');
    if (value?.[HTML_ATTRIBUTE] || value?.[HTML_URL]) {
        throw new TypeError('attribute() and url() values may only be used in matching quoted attributes.');
    }
    return renderValue(value);
}

function renderAttributeValue(name, value) {
    if (name.startsWith('on') || FORBIDDEN_ATTRIBUTES.has(name)) {
        throw new TypeError(`Dynamic ${name} attributes are not allowed.`);
    }
    if (URL_ATTRIBUTES.has(name)) {
        if (!value?.[HTML_URL]) {
            if (value?.[HTML_ATTRIBUTE]) throw new TypeError(`The ${name} attribute requires url().`);
            value = safeUrl(value);
        }
    } else if (!value?.[HTML_ATTRIBUTE]) {
        if (value?.[HTML_URL]) throw new TypeError(`The ${name} attribute requires attribute().`);
        if (isHtml(value)) throw new TypeError(`The ${name} attribute requires a primitive value.`);
        value = attribute(value);
    }
    return escapeHtml(value.value);
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
    const { language = 'text', label = language, highlight } = options;
    if (typeof language !== 'string' || !/^[A-Za-z0-9_+-]{1,32}$/.test(language)) {
        throw new TypeError('codeBlock() language must be a safe name of at most 32 characters.');
    }
    if (typeof label !== 'string') throw new TypeError('codeBlock() label must be a string.');
    if (highlight !== undefined && typeof highlight !== 'function') throw new TypeError('codeBlock() highlight must be a function.');
    const caption = label ? html`<figcaption>${label}</figcaption>` : html``;
    let content = isHtml(code) ? code : String(code ?? '');
    if (highlight) {
        if (isHtml(code)) throw new TypeError('codeBlock() cannot highlight an HtmlFragment.');
        content = synchronous(highlight(content, language), 'codeBlock() highlight must render synchronously.');
        if (!isHtml(content)) throw new TypeError('codeBlock() highlight must return an HtmlFragment.');
    }
    return html`<figure class="redweb-code">${caption}<pre><code class="${attribute(`language-${language}`)}">${content}</code></pre></figure>`;
}

module.exports = { attribute, codeBlock, each, escapeHtml, html, isHtml, markHtml, renderAttributeValue, renderValue, safeUrl, trustedHtml };
