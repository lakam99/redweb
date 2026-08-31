'use strict';

const { withTimeout } = require('../../tests/helpers/network');
const boundedTabs = new WeakSet();

/** Bound commands without mutating the caller's tab or taking socket ownership. */
function browserCommands(tab) {
    if (boundedTabs.has(tab)) return tab;
    const browser = { ...tab,
        evaluate: expression => withTimeout(tab.evaluate(expression), 'browser evaluation', 15000),
        command: (method, params) => withTimeout(tab.command(method, params), method, 15000),
    };
    boundedTabs.add(browser);
    return browser;
}

module.exports = { browserCommands };
