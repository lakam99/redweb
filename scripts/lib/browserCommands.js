'use strict';

const { withTimeout } = require('../../tests/helpers/network');

/** Bound commands without mutating the caller's tab or taking socket ownership. */
function browserCommands(tab) {
    return { ...tab,
        evaluate: expression => withTimeout(tab.evaluate(expression), 'browser evaluation', 15000),
        command: (method, params) => withTimeout(tab.command(method, params), method, 15000),
    };
}

module.exports = { browserCommands };
