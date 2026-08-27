const { isHtml, renderValue } = require('./Html');

const BINDING = /{{\s*([A-Za-z_$][\w$]*)\s*}}/g;
const ATTRIBUTE_BINDING = /{{\s*[A-Za-z_$][\w$]*\s*}}/;
const NAME = /^[A-Za-z_$][\w$]*$/;
const RAW_TEXT = new Set(['iframe', 'noembed', 'noframes', 'noscript', 'plaintext', 'script', 'style', 'textarea', 'title', 'xmp']);
const DIRECTIVES = new Set(['data-rw-state', 'data-rw-html', 'rw-each']);

function isHtmlSpace(character) {
    return character === ' ' || character === '\t' || character === '\n' || character === '\f' || character === '\r';
}

function isNonStartMarkup(source, start) {
    const marker = source[start + 1];
    if (marker === '!' || marker === '?') return true;
    return marker === '/' && /[A-Za-z]/.test(source[start + 2]);
}

function equalsAsciiCaseInsensitive(value, expected) {
    if (value.length !== expected.length) return false;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        const folded = code >= 65 && code <= 90 ? code + 32 : code;
        if (folded !== expected.charCodeAt(index)) return false;
    }
    return true;
}

function tagEnd(source, position) {
    let state = 'beforeAttribute';
    let quote;
    for (; position < source.length; position += 1) {
        const character = source[position];
        if (state === 'quotedValue') {
            if (character === quote) state = 'beforeAttribute';
            continue;
        }
        if (character === '>') return position;
        if (state === 'beforeValue') {
            if (isHtmlSpace(character)) continue;
            if (character === '"' || character === "'") {
                quote = character;
                state = 'quotedValue';
            } else state = 'unquotedValue';
        } else if (state === 'beforeAttribute') {
            if (!isHtmlSpace(character) && character !== '/') state = 'attributeName';
        } else if (state === 'attributeName') {
            if (character === '=') state = 'beforeValue';
            else if (isHtmlSpace(character)) state = 'afterAttributeName';
        } else if (state === 'afterAttributeName') {
            if (character === '=') state = 'beforeValue';
            else if (!isHtmlSpace(character) && character !== '/') state = 'attributeName';
        } else if (isHtmlSpace(character)) state = 'beforeAttribute';
    }
    return -1;
}

function rawClosingTag(source, name, position) {
    while (true) {
        const start = source.indexOf('</', position);
        if (start < 0) return null;
        const candidate = source.slice(start + 2, start + 2 + name.length);
        const boundary = source[start + 2 + name.length];
        if (equalsAsciiCaseInsensitive(candidate, name) && (boundary === '>' || boundary === '/' || isHtmlSpace(boundary))) {
            const end = tagEnd(source, start + 2 + name.length);
            if (end >= 0) return { start, end: end + 1 };
        }
        position = start + 2;
    }
}

function closingTag(source, target) {
    let position = 0;
    while (position < source.length) {
        const start = source.indexOf('<', position);
        if (start < 0) return -1;
        if (source.startsWith('<!--', start)) {
            const commentEnd = source.indexOf('-->', start + 4);
            position = commentEnd < 0 ? source.length : commentEnd + 3;
            continue;
        }
        const recognizedMarkup = isNonStartMarkup(source, start);
        if (!recognizedMarkup && !/[A-Za-z]/.test(source[start + 1])) {
            position = start + 1;
            continue;
        }
        const end = tagEnd(source, start + 1);
        if (end < 0) return -1;
        const tag = source.slice(start, end + 1);
        const closing = /^<\/([A-Za-z][\w:-]*)/i.exec(tag)?.[1]?.toLowerCase();
        if (closing === target) return start;
        const opening = /^<([A-Za-z][\w:-]*)/i.exec(tag)?.[1]?.toLowerCase();
        if (opening && RAW_TEXT.has(opening)) {
            if (opening === 'plaintext') return -1;
            const close = rawClosingTag(source, opening, end + 1);
            position = close ? close.end : source.length;
        } else {
            position = end + 1;
        }
    }
    return -1;
}

function attributes(tag, nameEnd) {
    const found = new Map();
    let position = nameEnd;
    while (position < tag.length - 1) {
        while (isHtmlSpace(tag[position])) position += 1;
        if (tag[position] === '>' || (tag[position] === '/' && tag[position + 1] === '>')) break;
        const start = position;
        while (position < tag.length && !/[ \t\n\f\r=/>]/.test(tag[position])) position += 1;
        if (start === position) throw new Error('Malformed HTML attribute.');
        const name = tag.slice(start, position).toLowerCase();
        while (isHtmlSpace(tag[position])) position += 1;
        let value = null;
        if (tag[position] === '=') {
            position += 1;
            while (isHtmlSpace(tag[position])) position += 1;
            const quote = tag[position];
            if (quote === '"' || quote === "'") {
                const valueStart = ++position;
                while (position < tag.length && tag[position] !== quote) position += 1;
                value = tag.slice(valueStart, position++);
            } else {
                const valueStart = position;
                while (position < tag.length && !/[ \t\n\f\r>]/.test(tag[position])) position += 1;
                value = tag.slice(valueStart, position);
            }
        }
        if (value && ATTRIBUTE_BINDING.test(value)) {
            throw new TypeError('Template bindings are only allowed in element text.');
        }
        if (DIRECTIVES.has(name)) {
            if (found.has(name)) throw new Error(`Duplicate Live HTML directive "${name}".`);
            found.set(name, value);
        }
    }
    return found;
}

class TemplateRenderer {
    constructor(source, page, collection) {
        this.source = source;
        this.page = page;
        this.collection = collection;
        this.position = 0;
        this.output = '';
    }

    render() {
        while (this.position < this.source.length) {
            if (this.source.startsWith('<!--', this.position)) this.comment();
            else if (this.source[this.position] === '<') this.markup();
            else this.text();
        }
        return this.output;
    }

    comment() {
        const end = this.source.indexOf('-->', this.position + 4);
        const next = end < 0 ? this.source.length : end + 3;
        this.output += this.source.slice(this.position, next);
        this.position = next;
    }

    markup() {
        const parsed = this.startTag();
        if (!parsed) {
            const recognizedMarkup = isNonStartMarkup(this.source, this.position);
            const recognizedStart = /[A-Za-z]/.test(this.source[this.position + 1]);
            const beginsMarkup = recognizedMarkup || recognizedStart;
            const end = beginsMarkup ? this.tagEnd(this.position + 1) : -1;
            if (beginsMarkup && end < 0) {
                this.output += this.source.slice(this.position);
                this.position = this.source.length;
                return;
            }
            const next = end < 0 ? this.position + 1 : end + 1;
            this.output += this.source.slice(this.position, next);
            this.position = next;
            return;
        }
        this.position = parsed.end;
        if (RAW_TEXT.has(parsed.name)) {
            if ([...parsed.attributes.keys()].some(name => DIRECTIVES.has(name))) {
                throw new Error('Live HTML directives are not allowed on raw-text elements.');
            }
            const close = parsed.name === 'plaintext' ? null : rawClosingTag(this.source, parsed.name, this.position);
            const next = close ? close.end : this.source.length;
            this.output += this.source.slice(parsed.start, next);
            this.position = next;
            return;
        }
        const each = parsed.attributes.get('rw-each');
        const state = parsed.attributes.get('data-rw-state');
        const hasEach = parsed.attributes.has('rw-each');
        const hasState = parsed.attributes.has('data-rw-state');
        const hasHtml = parsed.attributes.has('data-rw-html');
        if (hasHtml && parsed.attributes.get('data-rw-html') !== null) {
            throw new Error('data-rw-html must be a boolean attribute.');
        }
        if (hasHtml && !hasEach && !hasState) {
            throw new Error('data-rw-html requires data-rw-state or rw-each.');
        }
        if (!hasEach && !hasState) {
            this.output += parsed.source;
            return;
        }
        if (hasEach && !NAME.test(each || '')) throw new Error('rw-each requires a valid state name.');
        if (hasState && !NAME.test(state || '')) throw new Error('data-rw-state requires a valid state name.');
        if (hasEach && hasState && each !== state) {
            throw new Error(`Page collection "${each}" conflicts with state binding "${state}".`);
        }
        const name = each || state;
        if (!(name in this.page)) throw new Error(hasEach ? `Unknown page collection "${name}".` : `Unknown page binding "${name}".`);
        const closing = this.emptyClosing(parsed.name);
        const value = hasEach ? this.collection(this.page, name, this.page[name]) : renderValue(this.page[name]);
        const html = hasEach || isHtml(this.page[name]);
        let opening = parsed.source;
        if (!hasState) opening = opening.replace(/\/?>(?=$)/, ` data-rw-state="${name}"$&`);
        if (html && !hasHtml) opening = opening.replace(/\/?>(?=$)/, ' data-rw-html$&');
        this.output += opening + value + closing.source;
        this.position = closing.end;
    }

    startTag() {
        const start = this.position;
        let position = start + 1;
        if (!/[A-Za-z]/.test(this.source[position] || '')) return null;
        while (/[A-Za-z0-9:_-]/.test(this.source[position] || '')) position += 1;
        const name = this.source.slice(start + 1, position).toLowerCase();
        const end = this.tagEnd(position);
        if (end < 0) return null;
        const source = this.source.slice(start, end + 1);
        return { start, end: end + 1, name, source, attributes: attributes(source, position - start) };
    }

    tagEnd(position) {
        return tagEnd(this.source, position);
    }

    emptyClosing(name) {
        const contentStart = this.position;
        while (this.position < this.source.length && isHtmlSpace(this.source[this.position])) this.position += 1;
        const close = new RegExp(`^<\\/${name}[ \\t\\n\\f\\r]*>`, 'i').exec(this.source.slice(this.position));
        if (!close) throw new Error(`Live HTML binding on <${name}> requires an empty container.`);
        return {
            source: this.source.slice(contentStart, this.position) + close[0],
            end: this.position + close[0].length,
        };
    }

    text() {
        const end = this.source.indexOf('<', this.position);
        const next = end < 0 ? this.source.length : end;
        const text = this.source.slice(this.position, next).replace(BINDING, (_match, name) => {
            if (!(name in this.page)) throw new Error(`Unknown page binding "${name}".`);
            const value = this.page[name];
            return `<span data-rw-state="${name}"${isHtml(value) ? ' data-rw-html' : ''}>${renderValue(value)}</span>`;
        });
        this.output += text;
        this.position = next;
    }
}

TemplateRenderer.closingTag = closingTag;

module.exports = TemplateRenderer;
