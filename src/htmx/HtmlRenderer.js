const { assertTextContext, escapeHtml, isHtml, renderValue } = require('./Html');
const PageAssetLoader = require('./PageAssetLoader');
const { getViewImplementation } = require('./metadata');

const BINDING = /{{\s*([A-Za-z_$][\w$]*)\s*}}/g;
const TARGET = /(<([A-Za-z][\w:-]*)\b[^>]*\sdata-rw-state="([A-Za-z_$][\w$]*)"[^>]*>)(\s*)(<\/\2\s*>)/gi;
const COLLECTION = /(<([A-Za-z][\w:-]*)\b[^>]*\srw-each="([A-Za-z_$][\w$]*)"[^>]*>)(\s*)(<\/\2\s*>)/gi;

function serializeJson(value) {
    return JSON.stringify(value).replaceAll('<', '\\u003c');
}

class HtmlRenderer {
    static file(filePath, rootDir, kind) {
        return new PageAssetLoader().load(filePath, rootDir, kind).content;
    }

    static template(filePath, rootDir) {
        return HtmlRenderer.file(filePath, rootDir, 'template');
    }

    static stylesheet(filePath, rootDir) {
        return HtmlRenderer.file(filePath, rootDir, 'stylesheet');
    }

    static render(source, page) {
        if (typeof source !== 'string') throw new TypeError('Page markup must be a string.');
        const collections = source.replace(COLLECTION, (_match, opening, _tag, property, _content, closing) => {
            if (!(property in page)) throw new Error(`Unknown page collection "${property}".`);
            const content = HtmlRenderer.collection(page, property, page[property]);
            const existingState = opening.match(/\sdata-rw-state="([A-Za-z_$][\w$]*)"/i)?.[1];
            if (existingState && existingState !== property) {
                throw new Error(`Page collection "${property}" conflicts with state binding "${existingState}".`);
            }
            const markers = `${existingState ? '' : ` data-rw-state="${property}"`}${/\sdata-rw-html(?:\s|=|>)/i.test(opening) ? '' : ' data-rw-html'}`;
            return opening.replace(/>$/, `${markers}>`) + content + closing;
        });
        const targets = collections.replace(TARGET, (match, opening, _tag, property, _content, closing) => {
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

    static collection(page, name, value) {
        if (!Array.isArray(value)) throw new TypeError(`Page collection "${name}" must be an array.`);
        const renderItem = getViewImplementation(page.constructor, name);
        if (!renderItem) throw new Error(`Page collection "${name}" is missing @view metadata.`);
        return value.map((item, index) => {
            const rendered = renderItem.call(page, item, index);
            if (!isHtml(rendered)) throw new TypeError(`View for page collection "${name}" must return html.`);
            return rendered.toString();
        }).join('');
    }

    static statePayload(name, value, page) {
        if (page && getViewImplementation(page.constructor, name)) {
            return { name, value: HtmlRenderer.collection(page, name, value), html: true };
        }
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

module.exports = HtmlRenderer;
