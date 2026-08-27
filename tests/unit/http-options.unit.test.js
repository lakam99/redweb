const path = require('path');
const { BaseHttpServer, ENCODINGS, HTTP_OPTIONS } = require('../../src/http/BaseHttpServer');
const HttpsServer = require('../../src/http/HttpsServer');
const { closeServer, listenServer } = require('../../src/serverLifecycle');

const fixture = name => path.join(__dirname, '..', 'fixtures', name);

describe('HTTP option validation and lifecycle units', () => {
    test.each([
        [null, 'options must be an object'],
        [[], 'options must be an object'],
        ['bad', 'options must be an object'],
        [{ port: 1.5 }, '`port`'],
        [{ port: -1 }, '`port`'],
        [{ port: 65536 }, '`port`'],
        [{ bind: 7 }, '`bind`'],
        [{ bind: '' }, '`bind`'],
        [{ listen: null }, '`listen`'],
        [{ listenCallback: 'bad' }, '`listenCallback`'],
        [{ encoding: 'xml' }, '`encoding`'],
        [{ publicPaths: 'public' }, '`publicPaths`'],
        [{ publicPaths: [''] }, 'public path'],
        [{ publicPaths: [1] }, 'public path'],
        [{ services: {} }, '`services`'],
        [{ services: [null] }, 'serviceName'],
        [{ services: [{ serviceName: '', method: 'get', function() {} }] }, 'serviceName'],
        [{ services: [{ serviceName: '/x', method: 'trace', function() {} }] }, 'Unsupported HTTP'],
        [{ services: [{ serviceName: '/x', method: 'get' }] }, 'must provide a function'],
        [{ services: [
            { serviceName: '*', method: 'get', function() {} },
            { serviceName: '*', method: 'get', function() {} },
        ] }, 'Only one catch-all'],
        [{ server: {} }, 'Express-compatible'],
    ])('rejects invalid configuration %#', (options, message) => {
        expect(() => new BaseHttpServer(options)).toThrow(message);
    });

    test('copies mutable defaults and caller arrays', () => {
        const publicPaths = ['./one'];
        const services = [];
        const first = new BaseHttpServer({ publicPaths, services });
        const second = new BaseHttpServer();

        first.publicPaths.push('./two');
        first.services.push({ serviceName: '/late', method: 'get', function() {} });
        expect(publicPaths).toEqual(['./one']);
        expect(services).toEqual([]);
        expect(second.publicPaths).toEqual(HTTP_OPTIONS.publicPaths);
        expect(second.services).toEqual(HTTP_OPTIONS.services);
        expect(ENCODINGS).toEqual({ json: 'json', urlencoded: 'urlencoded' });
    });

    test('builds HTTPS without listening and shutdown is idempotent', async () => {
        const server = new HttpsServer({
            listen: false,
            ssl: { key: fixture('localhost.key'), cert: fixture('localhost.crt') },
        });
        expect(server.server.listening).toBe(false);
        await server.shutdown();
        await server.shutdown();
    });

    test('HTTPS construction without options fails with a useful TLS error', () => {
        expect(() => new HttpsServer()).toThrow('SSL key and certificate paths must be provided');
    });

    test('central lifecycle helper uses callbacks, logging, and error propagation', async () => {
        const messages = [];
        const fake = {
            listening: false,
            listen(port, bind, callback) {
                this.listening = true;
                expect([port, bind]).toEqual([1234, '127.0.0.1']);
                callback();
            },
            close(callback) {
                this.listening = false;
                callback();
            },
        };
        listenServer(fake, { port: 1234, bind: '127.0.0.1', logger: { log: value => messages.push(value) }, name: 'Test' });
        expect(messages).toEqual(['RedWeb Test listening on 127.0.0.1:1234']);
        await closeServer(fake);
        await closeServer(fake);

        let customCalled = false;
        listenServer(fake, { port: 1234, bind: '127.0.0.1', callback: () => { customCalled = true; } });
        expect(customCalled).toBe(true);
        fake.close = callback => callback(new Error('close failed'));
        await expect(closeServer(fake)).rejects.toThrow('close failed');
        await expect(closeServer()).resolves.toBeUndefined();
    });
});
