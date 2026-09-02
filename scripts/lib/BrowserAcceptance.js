'use strict';

const assert = require('node:assert/strict');

/** Small shared vocabulary for real-browser example acceptance. */
class BrowserAcceptance {
    constructor({ pages, debugPort, eventual, bounded }) {
        this.pages = pages;
        this.debugPort = debugPort;
        this.eventual = eventual;
        this.bounded = bounded;
    }

    open(origin, route = '/') {
        return this.pages.open(this.debugPort, `${origin}${route}`);
    }

    evaluate(page, expression, label = 'browser example evaluation') {
        return this.bounded(page.evaluate(expression), label);
    }

    wait(page, expression, label) {
        return this.evaluate(page, this.eventual(expression, label), label);
    }

    async style(page, selector, property, expected) {
        const actual = await this.evaluate(page,
            `getComputedStyle(document.querySelector(${JSON.stringify(selector)}))[${JSON.stringify(property)}]`);
        assert.equal(actual, expected, `${selector} ${property} was not applied`);
    }
}

module.exports = { BrowserAcceptance };
