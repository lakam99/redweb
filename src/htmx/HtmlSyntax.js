const RAW_TEXT = new Set(['iframe', 'noembed', 'noframes', 'noscript', 'plaintext', 'script', 'style', 'textarea', 'title', 'xmp']);

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

function scanTag(source, position) {
    let state = 'beforeAttribute';
    let quote;
    let attributeName = null;
    let attributeStart = -1;
    for (; position < source.length; position += 1) {
        const character = source[position];
        if (state === 'quotedValue') {
            if (character === quote) state = 'beforeAttribute';
            continue;
        }
        if (character === '>') return { end: position, state, attributeName };
        if (state === 'beforeValue') {
            if (isHtmlSpace(character)) continue;
            if (character === '"' || character === "'") {
                quote = character;
                state = 'quotedValue';
            } else state = 'unquotedValue';
        } else if (state === 'beforeAttribute') {
            if (!isHtmlSpace(character) && character !== '/') {
                attributeStart = position;
                state = 'attributeName';
            }
        } else if (state === 'attributeName') {
            if (character === '=') {
                attributeName = source.slice(attributeStart, position).toLowerCase();
                state = 'beforeValue';
            } else if (isHtmlSpace(character)) {
                attributeName = source.slice(attributeStart, position).toLowerCase();
                state = 'afterAttributeName';
            }
        } else if (state === 'afterAttributeName') {
            if (character === '=') state = 'beforeValue';
            else if (!isHtmlSpace(character) && character !== '/') {
                attributeStart = position;
                attributeName = null;
                state = 'attributeName';
            }
        } else if (isHtmlSpace(character)) state = 'beforeAttribute';
    }
    return { end: -1, state, attributeName };
}

function tagEnd(source, position) {
    return scanTag(source, position).end;
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

function tagLocation(source, target, kind) {
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
        if (kind === 'closing' && closing === target) return start;
        const opening = /^<([A-Za-z][\w:-]*)/i.exec(tag)?.[1]?.toLowerCase();
        if (kind === 'opening' && opening === target) return start;
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

function interpolationContext(source) {
    let position = 0;
    while (position < source.length) {
        const start = source.indexOf('<', position);
        if (start < 0) return { kind: 'text' };
        if (source.startsWith('<!--', start)) {
            const commentEnd = source.indexOf('-->', start + 4);
            if (commentEnd < 0) return { kind: 'protected' };
            position = commentEnd + 3;
            continue;
        }
        const opening = /^<([A-Za-z][\w:-]*)/.exec(source.slice(start));
        if (opening) {
            const name = opening[1].toLowerCase();
            const scanned = scanTag(source, start + opening[0].length);
            if (scanned.end < 0) {
                if (scanned.state === 'quotedValue' && scanned.attributeName) {
                    return { kind: 'attribute', name: scanned.attributeName };
                }
                return { kind: 'protected' };
            }
            if (RAW_TEXT.has(name)) {
                if (name === 'plaintext') return { kind: 'protected' };
                const close = rawClosingTag(source, name, scanned.end + 1);
                if (!close) return { kind: 'protected' };
                position = close.end;
            } else {
                position = scanned.end + 1;
            }
            continue;
        }
        if (isNonStartMarkup(source, start)) {
            const end = tagEnd(source, start + 1);
            if (end < 0) return { kind: 'protected' };
            position = end + 1;
        } else {
            position = start + 1;
        }
    }
    return { kind: 'text' };
}

module.exports = {
    RAW_TEXT,
    closingTag: (source, target) => tagLocation(source, target, 'closing'),
    interpolationContext,
    isHtmlSpace,
    isNonStartMarkup,
    openingTag: (source, target) => tagLocation(source, target, 'opening'),
    rawClosingTag,
    tagEnd,
};
