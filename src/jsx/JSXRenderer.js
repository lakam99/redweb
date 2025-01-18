const fs = require('fs');
const path = require('path');
const { transformSync } = require('esbuild');

function createElement(tag, props, ...children) {
    if (typeof tag === 'function') {
        return tag({ ...props, children });
    }

    const attributes = Object.entries(props || {})
        .map(([key, value]) => `${key}="${value}"`)
        .join(' ');

    // Only add a space before attributes if there are attributes
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

    return `${openingTag}${childrenHTML}</${tag}>`;
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
