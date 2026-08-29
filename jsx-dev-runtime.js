'use strict';

const { Fragment, createElement } = require('./src/htmx/Jsx');

function jsxDEV(type, properties) {
    return createElement(type, properties);
}

module.exports = { Fragment, jsxDEV };
