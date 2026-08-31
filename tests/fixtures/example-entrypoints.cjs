'use strict';

// Unit-only launcher isolation. Network acceptance runs the actual start()
// implementation separately in live-html.integration.test.js.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const directory = process.env.REDWEB_EXAMPLE_DIRECTORY;

test.each([
    ['counter', 'CounterPage', 8080], ['cards', 'CardsPage', 8080],
    ['components', 'ComponentsPage', 8080], ['jsx-page', 'JsxPage', 8181],
])('%s launches its documented page and port', (name, exported, port) => {
    const filename = path.join(directory, `${name}.js`);
    const realRequire = createRequire(filename);
    const start = jest.fn();
    const module = { exports: {} };
    const load = name => name === 'redweb' ? { ...realRequire(name), start } : realRequire(name);
    load.main = module;
    globalThis.__redwebApplicationCoverage__ ||= {};
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports, require: load, __filename: filename, __dirname: directory,
        __redwebApplicationCoverage__: globalThis.__redwebApplicationCoverage__,
    }, { filename });
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(module.exports[exported], { port });
});

test('counter cleanup is safe before connection and when repeated', () => {
    const { CounterPage } = require(path.join(directory, 'counter.js'));
    const counter = new CounterPage();
    counter.disconnected();
    counter.disconnected();
    expect(counter.count).toBe(0);
});
