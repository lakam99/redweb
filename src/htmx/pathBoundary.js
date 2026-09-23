'use strict';

const path = require('path');

function outside(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

module.exports = { outside };
