'use strict';

const { isHtml, renderAttributeValue, renderValue, trustedHtml } = require('./Html');
const synchronous = require('./synchronous');
const ReactiveRenderer = require('./ReactiveRenderer');

const Fragment = Symbol('redweb.Fragment');
const KEYS = new WeakMap();
const NAME = /^[A-Za-z][A-Za-z0-9:._-]*$/;
const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
    'meta', 'param', 'source', 'track', 'wbr',
]);
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);
const TERMINAL_ELEMENTS = new Set(['plaintext']);
const BOOLEAN_VALUE_ATTRIBUTES = new Set(['contenteditable', 'draggable', 'spellcheck', 'writingsuggestions']);
const ATTRIBUTE_ALIASES = Object.freeze({ className: 'class', htmlFor: 'for' });

function renderChild(value, keys = new Set()) {
    if (value === null || value === undefined || typeof value === 'boolean') return '';
    if (Array.isArray(value)) return value.map(child => renderChild(child, keys)).join('');
    if (isHtml(value)) {
        const key = KEYS.get(value);
        if (key !== undefined) {
            if (keys.has(key)) throw new Error('Duplicate JSX sibling key.');
            keys.add(key);
        }
        return renderValue(value);
    }
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
        let value = properties[originalName];
        if (normalizedName === 'translate' && typeof value === 'boolean') value = value ? 'yes' : 'no';
        const preservesFalse = normalizedName.startsWith('aria-') || normalizedName.startsWith('data-') ||
            BOOLEAN_VALUE_ATTRIBUTES.has(normalizedName);
        if (value === null || value === undefined || (value === false && !preservesFalse)) continue;
        if (value === true && !preservesFalse) {
            renderAttributeValue(normalizedName, value);
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

function createElement(type, properties, key) {
    const reactive = ReactiveRenderer.jsx();
    const props = properties == null ? {} : properties;
    if (!props || typeof props !== 'object' || Array.isArray(props)) {
        throw new TypeError('JSX properties must be an object.');
    }
    let result;
    if (type === Fragment) result = trustedHtml(renderChild(props.children));
    else if (typeof type === 'string') result = renderIntrinsic(type, props);
    else if (typeof type === 'function') result = renderComponent(type, props);
    else throw new TypeError('JSX element types must be intrinsic names or function components.');
    const elementKey = key ?? props.key;
    if (!reactive || elementKey === undefined) return result;
    const keyed = trustedHtml(ReactiveRenderer.key(renderValue(result), elementKey));
    if (elementKey !== null) KEYS.set(keyed, String(elementKey));
    return keyed;
}

module.exports = { Fragment, createElement, renderChild };
