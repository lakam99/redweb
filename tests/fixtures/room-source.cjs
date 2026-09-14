'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { verifyRoomApplication } = require('../../scripts/lib/verify-room-example');
const filename = path.join(process.env.REDWEB_EXAMPLE_DIRECTORY, 'room-access.js');

test('room access uses actual HTTP, admission, joining, broadcast and revocation', async () => {
    const { createApp } = require(filename);
    await verifyRoomApplication(await createApp(0));
}, 30000);

test('unit: local-demo launcher and authorization truth table', async () => {
    const realRequire = createRequire(filename);
    const redweb = realRequire('redweb');
    const module = { exports: {} };
    let pageOptions, applicationOptions, roomOptions;
    const shutdown = jest.fn().mockResolvedValue(undefined);
    const run = jest.fn().mockResolvedValue(undefined);
    const unitApi = { ...redweb,
        page: (route, options) => { pageOptions = options; return redweb.page(route, options); },
        SocketRoute: class { constructor(options) { roomOptions = options; } },
        defineApp: options => {
            applicationOptions = options;
            return { run, shutdown, revoke: jest.fn(), sockets: { routes: options.sockets.map(Route => new Route()) } };
        },
    };
    const load = name => name === 'redweb' ? unitApi : realRequire(name);
    load.main = module;
    const log = jest.fn();
    globalThis.__redwebApplicationCoverage__ ||= {};
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports, require: load, __filename: filename, __dirname: path.dirname(filename),
        process: {}, console: { log, error: jest.fn() },
        __redwebApplicationCoverage__: globalThis.__redwebApplicationCoverage__,
    }, { filename });
    await new Promise(resolve => setImmediate(resolve));
    expect(run).toHaveBeenCalledTimes(1);
    expect(applicationOptions).toEqual(expect.objectContaining({ port: 8181, bind: '127.0.0.1' }));
    expect(pageOptions.authorize({ principal: 'alice' })).toBe(true);
    expect(pageOptions.authorize({ principal: 'bob' })).toBe(false);
    expect(roomOptions.rooms.authorize({ principal: 'alice' }, 'team')).toBe(true);
    expect(roomOptions.rooms.authorize({ principal: 'alice' }, 'other')).toBe(false);
    expect(roomOptions.rooms.authorize({ principal: 'bob' }, 'team')).toBe(false);
    const authorization = log.mock.calls[1][0].replace('Authorization: ', '');
    expect(applicationOptions.authenticate({ headers: { authorization } })).toBe('alice');
    expect(applicationOptions.authenticate({ headers: {} })).toBe(false);
});
