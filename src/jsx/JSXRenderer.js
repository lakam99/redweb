const fs = require('fs');
const path = require('path');
const { transformSync } = require('esbuild');

function createElement(tag, props, ...children) {
    if (typeof tag === 'function') {
        return tag({ ...props, children });
    }

    const eventHandlers = [];
    const attributes = Object.entries(props || {})
        .map(([key, value]) => {
            if (/^on[A-Z]/.test(key)) {
                // Collect event handlers for later script generation
                const eventName = key.slice(2).toLowerCase(); // e.g., onClick -> click
                const handlerId = `handler_${Math.random().toString(36).substring(2, 9)}`;
                eventHandlers.push({ eventName, handler: value, handlerId });
                return `data-event-${eventName}="${handlerId}"`;
            }
            return `${key}="${value}"`;
        })
        .join(' ');

    const openingTag = attributes ? `<${tag} ${attributes}>` : `<${tag}>`;

    const childrenHTML = children
        .map((child) => {
            if (Array.isArray(child)) {
                return child.join('');
            } else if (typeof child === 'object') {
                return child;
            } else {
                return String(child);
            }
        })
        .join('');

    // Generate scripts only for event handlers
    const eventScripts = eventHandlers
        .map(({ eventName, handler, handlerId }) => {
            return `
                document.querySelectorAll('[data-event-${eventName}="${handlerId}"]').forEach(el => {
                    el.addEventListener('${eventName}', ${handler.toString()});
                });
            `;
        })
        .join('');

    const scriptTag = eventScripts ? `<script>${eventScripts}</script>` : '';

    return `${openingTag}${childrenHTML}</${tag}>${scriptTag}`;
}

function customRequire(parentPath, modulePath) {
    const resolvedPath = path.resolve(path.dirname(parentPath), modulePath);

    if (path.extname(resolvedPath) === '.jsx') {
        const source = fs.readFileSync(resolvedPath, 'utf8');

        // Transpile JSX into CommonJS
        const { code } = transformSync(source, {
            loader: 'jsx',
            format: 'cjs',
            target: 'es2018',
        });

        const sandbox = {
            module: { exports: {} },
            exports: {},
            createElement,
            React: { createElement },
            require: (subModulePath) => customRequire(resolvedPath, subModulePath),
        };

        const script = new Function(
            'require',
            'module',
            'exports',
            'createElement',
            'React',
            code
        );

        script(sandbox.require, sandbox.module, sandbox.exports, sandbox.createElement, sandbox.React);

        return sandbox.module.exports;
    }

    return require(resolvedPath);
}

/**
 * Render a JSX file with dynamic transpilation using `esbuild`.
 * @param {string} filePath - Path to the JSX file.
 * @param {object} [props] - Props to pass to the component.
 * @returns {string} - Rendered HTML.
 */
function render(filePath, props = {}) {
    const fullPath = path.resolve(filePath);

    if (!fs.existsSync(fullPath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    const source = fs.readFileSync(fullPath, 'utf8');

    // Transpile JSX into CommonJS
    const { code } = transformSync(source, {
        loader: 'jsx',
        format: 'cjs',
        target: 'es2018',
    });

    const sandbox = {
        module: { exports: {} },
        exports: {},
        createElement,
        React: { createElement },
        require: (modulePath) => customRequire(fullPath, modulePath),
    };

    const script = new Function(
        'require',
        'module',
        'exports',
        'createElement',
        'React',
        code
    );

    script(sandbox.require, sandbox.module, sandbox.exports, sandbox.createElement, sandbox.React);

    const Component = sandbox.module.exports;

    if (typeof Component !== 'function') {
        throw new Error(`Invalid export from ${filePath}: Expected a function.`);
    }

    return Component(props);
}

module.exports = { render, createElement };
