const { assertTextContext, escapeHtml, isHtml, renderValue } = require('./Html');
const PageAssetLoader = require('./PageAssetLoader');

const BINDING = /{{\s*([A-Za-z_$][\w$]*)\s*}}/g;
const TARGET = /(<([A-Za-z][\w:-]*)\b[^>]*\sdata-rw-state="([A-Za-z_$][\w$]*)"[^>]*>)(\s*)(<\/\2\s*>)/gi;

function serializeJson(value) {
    return JSON.stringify(value).replaceAll('<', '\\u003c');
}

class HtmxRenderer {
    static file(filePath, rootDir, kind) {
        return new PageAssetLoader().load(filePath, rootDir, kind).content;
    }

    static template(filePath, rootDir) {
        return HtmxRenderer.file(filePath, rootDir, 'template');
    }

    static stylesheet(filePath, rootDir) {
        return HtmxRenderer.file(filePath, rootDir, 'stylesheet');
    }

    static render(source, page) {
        if (typeof source !== 'string') throw new TypeError('Page markup must be a string.');
        const targets = source.replace(TARGET, (match, opening, _tag, property, _content, closing) => {
            if (!(property in page)) throw new Error(`Unknown page binding "${property}".`);
            const value = page[property];
            const htmlMarker = isHtml(value) && !/\sdata-rw-html(?:\s|=|>)/i.test(opening) ? ' data-rw-html' : '';
            return opening.replace(/>$/, `${htmlMarker}>`) + renderValue(value) + closing;
        });
        return targets.replace(BINDING, (_match, property, offset, whole) => {
            assertTextContext(whole.slice(0, offset));
            if (!(property in page)) throw new Error(`Unknown page binding "${property}".`);
            const value = page[property];
            return `<span data-rw-state="${property}"${isHtml(value) ? ' data-rw-html' : ''}>${renderValue(value)}</span>`;
        });
    }

    static statePayload(name, value) {
        return { name, value: isHtml(value) ? value.toString() : String(value ?? ''), html: isHtml(value) };
    }

    static document(markup, config, stylesheets = []) {
        const bootstrap = `<script type="application/json" id="__redweb_page">${serializeJson(config)}</script>` +
            `<script type="module" src="${escapeHtml(config.runtimePath)}"></script>`;
        const links = stylesheets.map(href => `<link rel="stylesheet" href="${escapeHtml(href)}">`).join('');
        if (/<\/body\s*>/i.test(markup)) {
            const hasHead = /<\/head\s*>/i.test(markup);
            const styled = links && hasHead ? markup.replace(/<\/head\s*>/i, `${links}</head>`) : markup;
            return styled.replace(/<\/body\s*>/i, `${hasHead ? '' : links}${bootstrap}</body>`);
        }
        return `<!doctype html><html><head>${links}</head><body><main data-rw-root>${markup}</main>${bootstrap}</body></html>`;
    }
}

module.exports = HtmxRenderer;
