const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    BaseHttpServer,
    HttpServer,
    HttpsServer,
    METHODS,
} = require('../..');
const { request, silentLogger, waitForListening } = require('../helpers/network');

const fixture = name => path.join(__dirname, '..', 'fixtures', name);

describe('HTTP and HTTPS integration', () => {
    const servers = new Set();
    const temporaryDirectories = new Set();

    afterEach(async () => {
        await Promise.all([...servers].map(server => server.shutdown()));
        servers.clear();
        for (const directory of temporaryDirectories) {
            fs.rmSync(directory, { recursive: true, force: true });
        }
        temporaryDirectories.clear();
    });

    function tempPublicDirectory() {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-http-'));
        temporaryDirectories.add(directory);
        return directory;
    }

    async function start(ServerClass, options = {}) {
        const server = new ServerClass({ port: 0, bind: '127.0.0.1', logger: silentLogger, ...options });
        servers.add(server);
        await waitForListening(server.server);
        return server;
    }

    test('serves static files, parses JSON, preserves service options, and honors bind', async () => {
        const publicPath = tempPublicDirectory();
        fs.writeFileSync(path.join(publicPath, 'hello.txt'), 'static response');
        const services = [
            {
                serviceName: '/echo',
                method: METHODS.POST,
                function: (req, res) => res.json(req.body),
            },
            {
                serviceName: '*',
                method: METHODS.GET,
                function: (_req, res) => res.status(404).send('custom missing'),
            },
        ];

        const server = await start(HttpServer, { publicPaths: [publicPath], services });
        const port = server.server.address().port;
        const staticResponse = await request({ port, path: '/hello.txt' });
        const jsonResponse = await request({
            port,
            path: '/echo',
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ value: 42 }),
        });
        const missingResponse = await request({ port, path: '/missing' });

        expect(server.server.address().address).toBe('127.0.0.1');
        expect(staticResponse).toMatchObject({ status: 200, body: 'static response' });
        expect(JSON.parse(jsonResponse.body)).toEqual({ value: 42 });
        expect(missingResponse).toMatchObject({ status: 404, body: 'custom missing' });
        expect(services).toHaveLength(2);
        expect(services[1].serviceName).toBe('*');
    });

    test('supports URL-encoded requests and configurable or disabled CORS', async () => {
        const encoded = await start(HttpServer, {
            encoding: 'urlencoded',
            corsOptions: { origin: 'https://allowed.example' },
            services: [{
                serviceName: '/form',
                method: METHODS.POST,
                function: (req, res) => res.json(req.body),
            }],
        });
        const encodedResponse = await request({
            port: encoded.server.address().port,
            path: '/form',
            method: 'POST',
            headers: {
                origin: 'https://allowed.example',
                'content-type': 'application/x-www-form-urlencoded',
            },
            body: 'name=Redweb',
        });
        expect(encodedResponse.headers['access-control-allow-origin']).toBe('https://allowed.example');
        expect(JSON.parse(encodedResponse.body)).toEqual({ name: 'Redweb' });

        const noCors = await start(HttpServer, {
            corsOptions: false,
            services: [{ serviceName: '/ok', method: METHODS.GET, function: (_req, res) => res.send('ok') }],
        });
        const noCorsResponse = await request({
            port: noCors.server.address().port,
            path: '/ok',
            headers: { origin: 'https://example.com' },
        });
        expect(noCorsResponse.headers['access-control-allow-origin']).toBeUndefined();
    });

    test('serves real TLS traffic and invokes the listening callback', async () => {
        let callbackInvoked = false;
        const server = await start(HttpsServer, {
            ssl: { key: fixture('localhost.key'), cert: fixture('localhost.crt') },
            listenCallback: () => { callbackInvoked = true; },
            services: [{ serviceName: '/secure', method: METHODS.GET, function: (_req, res) => res.json({ secure: true }) }],
        });

        const response = await request({
            protocol: 'https:',
            port: server.server.address().port,
            path: '/secure',
        });
        expect(callbackInvoked).toBe(true);
        expect(JSON.parse(response.body)).toEqual({ secure: true });
    });

    test('configures an existing Express application without creating a listener', async () => {
        const first = new BaseHttpServer({
            services: [{ serviceName: '/base', method: METHODS.GET, function: (_req, res) => res.send('base') }],
        });
        const second = new BaseHttpServer({
            server: first.app,
            services: [{ serviceName: '/second', method: METHODS.GET, function: (_req, res) => res.send('second') }],
        });
        const server = await start(HttpServer, { server: second.app });

        const port = server.server.address().port;
        expect((await request({ port, path: '/base' })).body).toBe('base');
        expect((await request({ port, path: '/second' })).body).toBe('second');
    });
});
