'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { verifyRoomApplication } = require('../../scripts/lib/verify-room-example');
const filename = path.join(process.env.REDWEB_EXAMPLE_DIRECTORY, 'room-access.js');

test('room access uses actual HTTP, admission, joining, broadcast and revocation', async () => {
    const { createApp } = require(filename);
    await verifyRoomApplication(createApp(0));
}, 30000);

test('unit: local-demo launcher, signal cleanup and authorization truth table', async () => {
    const realRequire = createRequire(filename);
    const redweb = realRequire('redweb');
    const module = { exports: {} };
    const signals = new Map();
    let pageOptions, applicationOptions, roomOptions;
    const shutdown = jest.fn().mockResolvedValue(undefined);
    const listen = jest.fn();
    const unitApi = { ...redweb,
        page: (route, options) => { pageOptions = options; return redweb.page(route, options); },
        SocketRoute: class { constructor(options) { roomOptions = options; } },
        start: (_Page, options) => {
            applicationOptions = options;
            return { server: { listen }, shutdown, sockets: { addRoute: Route => new Route() } };
        },
    };
    const load = name => name === 'redweb' ? unitApi : realRequire(name);
    load.main = module;
    const log = jest.fn();
    globalThis.__redwebApplicationCoverage__ ||= {};
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports, require: load, __filename: filename, __dirname: path.dirname(filename),
        process: { once: (signal, callback) => signals.set(signal, callback) }, console: { log, error: jest.fn() },
        __redwebApplicationCoverage__: globalThis.__redwebApplicationCoverage__,
    }, { filename });
    expect(listen).toHaveBeenCalledWith(8181, '127.0.0.1');
    expect([...signals.keys()]).toEqual(['SIGTERM', 'SIGINT']);
    for (const callback of signals.values()) callback();
    await Promise.resolve();
    expect(shutdown).toHaveBeenCalledTimes(2);
    expect(pageOptions.authorize({ principal: 'alice' })).toBe(true);
    expect(pageOptions.authorize({ principal: 'bob' })).toBe(false);
    expect(roomOptions.rooms.authorize({ principal: 'alice' }, 'team')).toBe(true);
    expect(roomOptions.rooms.authorize({ principal: 'alice' }, 'other')).toBe(false);
    expect(roomOptions.rooms.authorize({ principal: 'bob' }, 'team')).toBe(false);
    const authorization = log.mock.calls[1][0].replace('Authorization: ', '');
    expect(applicationOptions.authenticate({ headers: { authorization } })).toBe('alice');
    expect(applicationOptions.authenticate({ headers: {} })).toBe(false);
});
