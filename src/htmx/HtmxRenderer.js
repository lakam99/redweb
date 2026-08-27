const fs = require('fs');
const path = require('path');
const { assertTextContext, isHtml, renderValue } = require('./Html');

const BINDING = /{{\s*([A-Za-z_$][\w$]*)\s*}}/g;
const TARGET = /(<([A-Za-z][\w:-]*)\b[^>]*\sdata-rw-state="([A-Za-z_$][\w$]*)"[^>]*>)(\s*)(<\/\2\s*>)/gi;

function serializeJson(value) {
    return JSON.stringify(value).replaceAll('<', '\\u003c');
}

class HtmxRenderer {
    static template(filePath, rootDir) {
        const root = path.resolve(rootDir);
        const resolved = path.resolve(root, filePath);
        const relative = path.relative(root, resolved);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            throw new Error('Page template is outside the configured template root.');
        }
        if (!fs.existsSync(resolved)) throw new Error(`Page template not found: ${resolved}`);
        return fs.readFileSync(resolved, 'utf8');
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

    static document(markup, config) {
        const bootstrap = `<script type="application/json" id="__redweb_page">${serializeJson(config)}</script>` +
            `<script type="module" src="${config.runtimePath}"></script>`;
        if (/<\/body\s*>/i.test(markup)) return markup.replace(/<\/body\s*>/i, `${bootstrap}</body>`);
        return `<!doctype html><html><body><main data-rw-root>${markup}</main>${bootstrap}</body></html>`;
    }
}

module.exports = HtmxRenderer;
