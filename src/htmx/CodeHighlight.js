const KEYWORDS = new Set([
    'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for',
    'from', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new',
    'of', 'return', 'static', 'super', 'switch', 'throw', 'try', 'typeof',
    'var', 'while', 'yield',
]);
const LITERALS = new Set(['false', 'null', 'true', 'undefined']);
const LANGUAGES = new Set(['js', 'javascript', 'ts', 'typescript', 'tsx']);
const identifierStart = character => /[A-Za-z_$]/.test(character);
const identifierPart = character => /[A-Za-z0-9_$]/.test(character);

function actionAttributeBefore(source, brace) {
    let index = brace - 1;
    while (index >= 0 && /\s/.test(source[index])) index -= 1;
    if (source[index] !== '=') return false;
    index -= 1;
    while (index >= 0 && /\s/.test(source[index])) index -= 1;
    const end = index + 1;
    while (index >= 0 && /[\w-]/.test(source[index])) index -= 1;
    return /^rw-[\w-]+$/.test(source.slice(index + 1, end));
}

function quotedEnd(source, start) {
    const quote = source[start];
    let index = start + 1;
    while (index < source.length) {
        if (source[index] === '\\') index += 2;
        else if (source[index++] === quote) break;
    }
    return index;
}

function tokens(source) {
    const result = [];
    let index = 0;
    let actionDepth = 0;
    const push = (kind, end) => {
        result.push({ kind, value: source.slice(index, end) });
        index = end;
    };
    while (index < source.length) {
        if (source.startsWith('//', index)) {
            const newline = source.indexOf('\n', index);
            push('comment', newline < 0 ? source.length : newline);
            continue;
        }
        if (source.startsWith('/*', index)) {
            const close = source.indexOf('*/', index + 2);
            push('comment', close < 0 ? source.length : close + 2);
            continue;
        }
        const character = source[index];
        if (character === '{') {
            if (actionDepth) actionDepth += 1;
            else if (actionAttributeBefore(source, index)) actionDepth = 1;
            push('plain', index + 1);
            continue;
        }
        if (character === '}') {
            if (actionDepth) actionDepth -= 1;
            push('plain', index + 1);
            continue;
        }
        if (character === "'" || character === '"' || character === '`') {
            push('string', quotedEnd(source, index));
            continue;
        }
        if (/\d/.test(character)) {
            const match = /^(?:0[xob][\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(source.slice(index));
            push('number', index + match[0].length);
            continue;
        }
        if (identifierStart(character)) {
            let end = index + 1;
            while (end < source.length && identifierPart(source[end])) end += 1;
            const value = source.slice(index, end);
            push(KEYWORDS.has(value) ? 'keyword' : LITERALS.has(value) ? 'literal' : actionDepth ? 'reference' : 'plain', end);
            continue;
        }
        let end = index + 1;
        while (end < source.length && !source.startsWith('//', end) && !source.startsWith('/*', end)
            && !['{', '}', "'", '"', '`'].includes(source[end]) && !/\d/.test(source[end])
            && !identifierStart(source[end])) end += 1;
        push('plain', end);
    }
    return result;
}

function highlightCode(source, language) {
    const { html } = require('./Html');
    if (!LANGUAGES.has(language)) return html`${source}`;
    return html`${tokens(source).map(token => token.kind === 'plain'
        ? html`${token.value}`
        : html`<span class="${`token-${token.kind}`}">${token.value}</span>`)}`;
}

module.exports = { highlightCode };
