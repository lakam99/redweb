'use strict';

const { isHtml, renderAttributeValue, renderValue, trustedHtml } = require('./Html');
const synchronous = require('./synchronous');

const Fragment = Symbol('redweb.Fragment');
const NAME = /^[A-Za-z][A-Za-z0-9:._-]*$/;
const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
    'meta', 'param', 'source', 'track', 'wbr',
]);
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);
const TERMINAL_ELEMENTS = new Set(['plaintext']);
const BOOLEAN_ATTRIBUTES = new Set([
    'allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked', 'controls',
    'default', 'defer', 'disabled', 'formnovalidate', 'hidden', 'inert', 'ismap',
    'itemscope', 'loop', 'multiple', 'muted', 'nomodule', 'novalidate', 'open',
    'playsinline', 'readonly', 'required', 'reversed', 'selected',
]);
const ATTRIBUTE_ALIASES = Object.freeze({ className: 'class', htmlFor: 'for' });

function renderChild(value) {
    if (value === null || value === undefined || typeof value === 'boolean') return '';
    if (Array.isArray(value)) return value.map(renderChild).join('');
    if (isHtml(value)) return renderValue(value);
    if (['string', 'number', 'bigint'].includes(typeof value)) return renderValue(value);
    throw new TypeError('JSX children must be text, numbers, HtmlFragment values, or arrays of those values.');
}

function renderAttributes(properties) {
    const attributes = [];
    const renderedNames = new Set();
    for (const originalName of Object.keys(properties)) {
        if (originalName === 'children' || originalName === 'key') continue;
        const name = Object.hasOwn(ATTRIBUTE_ALIASES, originalName) ? ATTRIBUTE_ALIASES[originalName] : originalName;
        if (!NAME.test(name)) throw new TypeError(`Invalid JSX attribute name: ${name}.`);
        const normalizedName = name.toLowerCase();
        if (renderedNames.has(normalizedName)) throw new TypeError(`Duplicate JSX attribute: ${name}.`);
        renderedNames.add(normalizedName);
        const value = properties[originalName];
        if (value === null || value === undefined || (value === false && BOOLEAN_ATTRIBUTES.has(normalizedName))) continue;
        if (value === true && BOOLEAN_ATTRIBUTES.has(normalizedName)) {
            attributes.push(name);
            continue;
        }
        attributes.push(`${name}="${renderAttributeValue(normalizedName, value)}"`);
    }
    return attributes.length ? ` ${attributes.join(' ')}` : '';
}

function renderIntrinsic(name, properties) {
    if (!NAME.test(name)) throw new TypeError(`Invalid JSX element name: ${name}.`);
    const normalizedName = name.toLowerCase();
    if (TERMINAL_ELEMENTS.has(normalizedName)) throw new TypeError(`JSX <${name}> is not supported because it prevents subsequent HTML from rendering.`);
    const attributes = renderAttributes(properties);
    const children = properties.children;
    const renderedChildren = renderChild(children);
    if (VOID_ELEMENTS.has(normalizedName)) {
        if (renderedChildren) {
            throw new TypeError(`JSX void element <${name}> cannot have children.`);
        }
        return trustedHtml(`<${name}${attributes}>`);
    }
    if (RAW_TEXT_ELEMENTS.has(normalizedName) && renderedChildren) {
        throw new TypeError(`JSX <${name}> children are not supported; use an external asset.`);
    }
    return trustedHtml(`<${name}${attributes}>${renderedChildren}</${name}>`);
}

function renderComponent(Component, properties) {
    const result = synchronous(Component(properties), 'JSX components must render synchronously.');
    if (!isHtml(result)) throw new TypeError('JSX components must return an HtmlFragment.');
    return Array.isArray(result) ? trustedHtml(renderValue(result)) : result;
}

function createElement(type, properties) {
    const props = properties == null ? {} : properties;
    if (!props || typeof props !== 'object' || Array.isArray(props)) {
        throw new TypeError('JSX properties must be an object.');
    }
    if (type === Fragment) return trustedHtml(renderChild(props.children));
    if (typeof type === 'string') return renderIntrinsic(type, props);
    if (typeof type === 'function') return renderComponent(type, props);
    throw new TypeError('JSX element types must be intrinsic names or function components.');
}

module.exports = { Fragment, createElement, renderChild };
