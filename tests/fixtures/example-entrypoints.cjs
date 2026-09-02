'use strict';

// Unit-only launcher isolation. Network acceptance runs the actual page runtime
// separately in live-html.integration.test.js; define-app tests cover ownership.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const directory = process.env.REDWEB_EXAMPLE_DIRECTORY;

const examples = [
    ['counter', 'CounterPage', 8080], ['cards', 'CardsPage', 8080],
    ['components', 'ComponentsPage', 8080], ['jsx-page', 'JsxPage', 8181],
];
test.each(examples.flatMap(example => [false, true].map(fails => [...example, fails])))
('unit: %s launches %s on port %i (startup fails=%s)', async (name, exported, port, fails) => {
    const filename = path.join(directory, `${name}.js`);
    const realRequire = createRequire(filename);
    const failure = new Error('intentional launcher failure');
    const run = jest.fn(() => fails ? Promise.reject(failure) : Promise.resolve());
    const defineApp = jest.fn(() => ({ run }));
    const processState = {};
    const consoleState = { error: jest.fn() };
    const module = { exports: {} };
    const load = name => name === 'redweb' ? { ...realRequire(name), defineApp } : realRequire(name);
    load.main = module;
    globalThis.__redwebApplicationCoverage__ ||= {};
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports, require: load, __filename: filename, __dirname: directory,
        process: processState, console: consoleState,
        __redwebApplicationCoverage__: globalThis.__redwebApplicationCoverage__,
    }, { filename });
    expect(defineApp).toHaveBeenCalledTimes(1);
    expect(defineApp).toHaveBeenCalledWith({ pages: [module.exports[exported]], port });
    expect(run).toHaveBeenCalledTimes(1);
    await run.mock.results[0].value.catch(() => {});
    expect(processState.exitCode).toBe(fails ? 1 : undefined);
    if (fails) expect(consoleState.error).toHaveBeenCalledWith(failure);
    else expect(consoleState.error).not.toHaveBeenCalled();
});

test('counter cleanup is safe before connection and when repeated', () => {
    const { CounterPage } = require(path.join(directory, 'counter.js'));
    const counter = new CounterPage();
    counter.disconnected();
    counter.disconnected();
    expect(counter.count).toBe(0);
});
