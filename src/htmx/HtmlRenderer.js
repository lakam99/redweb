const { escapeHtml, isHtml, renderValue } = require('./Html');
const PageAssetLoader = require('./PageAssetLoader');
const TemplateRenderer = require('./TemplateRenderer');
const { getStateConfig, getViewMetadata } = require('./metadata');

function serializeJson(value) {
    return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function meta(attribute, name, content) {
    return `<meta ${attribute}="${escapeHtml(name)}" content="${escapeHtml(content)}">`;
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

    static render(source, page, options = {}) {
        if (typeof source !== 'string') throw new TypeError('Page markup must be a string.');
        if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Render options must be an object.');
        const { live = true } = options;
        if (typeof live !== 'boolean') throw new TypeError('Render live must be a boolean.');
        return new TemplateRenderer(source, page, HtmlRenderer.collection, live).render();
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

    static head(metadata = {}) {
        const tags = [];
        if (metadata.title) tags.push(`<title>${escapeHtml(metadata.title)}</title>`, meta('property', 'og:title', metadata.title), meta('name', 'twitter:title', metadata.title));
        if (metadata.description) tags.push(meta('name', 'description', metadata.description), meta('property', 'og:description', metadata.description), meta('name', 'twitter:description', metadata.description));
        if (metadata.canonical) tags.push(`<link rel="canonical" href="${escapeHtml(metadata.canonical)}">`, meta('property', 'og:url', metadata.canonical));
        if (metadata.image) tags.push(meta('property', 'og:image', metadata.image), meta('name', 'twitter:image', metadata.image));
        if (metadata.robots) tags.push(meta('name', 'robots', metadata.robots));
        if (metadata.title || metadata.description || metadata.image) tags.push(meta('name', 'twitter:card', metadata.image ? 'summary_large_image' : 'summary'));
        return tags.join('');
    }

    static document(markup, config = null, stylesheets = [], metadata = {}) {
        const bootstrap = config ? `<script type="application/json" id="__redweb_page">${serializeJson(config)}</script>` +
            `<script type="module" src="${escapeHtml(config.runtimePath)}"></script>` : '';
        const links = stylesheets.map(href => `<link rel="stylesheet" href="${escapeHtml(href)}">`).join('');
        const headMarkup = HtmlRenderer.head(metadata) + links;
        const body = TemplateRenderer.closingTag(markup, 'body');
        if (body >= 0) {
            const head = TemplateRenderer.closingTag(markup, 'head');
            const insertions = [{ position: body, value: bootstrap }];
            if (head >= 0) {
                if (headMarkup) insertions.push({ position: head, value: headMarkup });
            } else if (headMarkup) {
                const bodyOpen = TemplateRenderer.openingTag(markup, 'body');
                insertions.push({ position: Math.max(0, bodyOpen), value: `<head>${headMarkup}</head>` });
            }
            return insertions.sort((left, right) => right.position - left.position)
                .reduce((result, insertion) => result.slice(0, insertion.position) + insertion.value + result.slice(insertion.position), markup);
        }
        return `<!doctype html><html><head>${headMarkup}</head><body><main data-rw-root>${markup}</main>${bootstrap}</body></html>`;
    }
}

module.exports = HtmlRenderer;
