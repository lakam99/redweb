const { escapeHtml, isHtml, renderValue } = require('./Html');
const PageAssetLoader = require('./PageAssetLoader');
const TemplateRenderer = require('./TemplateRenderer');
const { getStateConfig, getViewMetadata } = require('./metadata');

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
        return new TemplateRenderer(source, page, HtmlRenderer.collection).render();
    }

    static collection(page, name, value) {
        if (!getStateConfig(page.constructor, name)) throw new Error(`Page collection "${name}" is missing @state metadata.`);
        if (!Array.isArray(value)) throw new TypeError(`Page collection "${name}" must be an array.`);
        const view = getViewMetadata(page.constructor, name);
        if (!view) throw new Error(`Page collection "${name}" is missing @view metadata.`);
        if (page[view.method] !== view.implementation) throw new Error(`View for page collection "${name}" was replaced.`);
        return value.map((item, index) => {
            const rendered = view.implementation.call(page, item, index);
            if (!isHtml(rendered)) throw new TypeError(`View for page collection "${name}" must return html.`);
            return rendered.toString();
        }).join('');
    }

    static statePayload(name, value, page) {
        if (page && getViewMetadata(page.constructor, name)) {
            return { name, value: HtmlRenderer.collection(page, name, value), html: true };
        }
        return { name, value: isHtml(value) ? renderValue(value) : String(value ?? ''), html: isHtml(value) };
    }

    static document(markup, config, stylesheets = []) {
        const bootstrap = `<script type="application/json" id="__redweb_page">${serializeJson(config)}</script>` +
            `<script type="module" src="${escapeHtml(config.runtimePath)}"></script>`;
        const links = stylesheets.map(href => `<link rel="stylesheet" href="${escapeHtml(href)}">`).join('');
        const body = TemplateRenderer.closingTag(markup, 'body');
        if (body >= 0) {
            const head = TemplateRenderer.closingTag(markup, 'head');
            const insertions = [{ position: body, value: `${head >= 0 ? '' : links}${bootstrap}` }];
            if (links && head >= 0) insertions.push({ position: head, value: links });
            return insertions.sort((left, right) => right.position - left.position)
                .reduce((result, insertion) => result.slice(0, insertion.position) + insertion.value + result.slice(insertion.position), markup);
        }
        return `<!doctype html><html><head>${links}</head><body><main data-rw-root>${markup}</main>${bootstrap}</body></html>`;
    }
}

module.exports = HtmlRenderer;
