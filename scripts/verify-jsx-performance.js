'use strict';

const { jsx, jsxs } = require('../jsx-runtime');

if (typeof global.gc !== 'function') throw new Error('Run the JSX performance gate with --expose-gc.');

const count = 10_000;
const Row = properties => jsxs('li', {
    class: 'row',
    'data-index': properties.index,
    children: [jsx('strong', { children: properties.label }), ': ', properties.index],
});

// Validate outside the timed render and release the oracle before heap sampling.
function verifyMarkup(output) {
    const expected = '<ul>' + Array.from({ length: count }, (_, index) =>
        `<li class="row" data-index="${index}"><strong>&lt;safe&gt;</strong>: ${index}</li>`).join('') + '</ul>';
    if (output !== expected) throw new Error('The JSX performance render produced incorrect markup.');
}

global.gc();
const baseline = process.memoryUsage().heapUsed;
const started = process.hrtime.bigint();
let page = jsx('ul', {
    children: Array.from({ length: count }, (_, index) => jsx(Row, { index, label: '<safe>' })),
});
let output = page.toString();
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

verifyMarkup(output);
if (elapsedMs > 5_000) throw new Error(`Rendering ${count} JSX rows took ${elapsedMs.toFixed(1)}ms.`);

page = null;
output = null;
global.gc();
const retainedBytes = Math.max(0, process.memoryUsage().heapUsed - baseline);
if (retainedBytes > 32 * 1024 * 1024) {
    throw new Error(`The JSX performance render retained ${(retainedBytes / 1024 / 1024).toFixed(1)} MiB.`);
}

console.log(`JSX performance gate passed: ${count} component rows in ${elapsedMs.toFixed(1)}ms; ${(retainedBytes / 1024 / 1024).toFixed(1)} MiB retained.`);
