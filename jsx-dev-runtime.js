'use strict';

const { Fragment, createElement } = require('./src/htmx/Jsx');

function jsxDEV(type, properties, key) {
    return createElement(type, properties, key);
}

module.exports = { Fragment, jsxDEV };
