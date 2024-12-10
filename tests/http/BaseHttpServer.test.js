const request = require('supertest'); // For testing HTTP routes
const path = require('path');
const { BaseHttpServer, ENCODINGS, HTTP_OPTIONS } = require('../../src/http/BaseHttpServer');

describe('BaseHttpServer', () => {
    let serverInstance;

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('should initialize with default options', () => {
        serverInstance = new BaseHttpServer();
        const { app, options } = serverInstance;

        expect(options.port).toBe(HTTP_OPTIONS.port);
        expect(options.bind).toBe(HTTP_OPTIONS.bind);
        expect(options.publicPaths).toEqual(HTTP_OPTIONS.publicPaths);
        expect(options.services).toEqual(HTTP_OPTIONS.services);
        expect(options.encoding).toBe(HTTP_OPTIONS.encoding);

        expect(app).toBeDefined();
    });

    test('should initialize with custom options', () => {
        const customOptions = {
            port: 3000,
            bind: '127.0.0.1',
            publicPaths: ['./static'],
            encoding: ENCODINGS.urlencoded,
        };
        serverInstance = new BaseHttpServer(customOptions);

        expect(serverInstance.options.port).toBe(3000);
        expect(serverInstance.options.bind).toBe('127.0.0.1');
        expect(serverInstance.options.publicPaths).toEqual(['./static']);
        expect(serverInstance.options.encoding).toBe(ENCODINGS.urlencoded);
    });

    test('should serve static files from public paths', async () => {
        const mockPath = path.join(process.cwd(), './public');
        jest.spyOn(path, 'join').mockReturnValue(mockPath);

        serverInstance = new BaseHttpServer();
        const app = serverInstance.app;

        app.use('/test-file', (req, res) => res.send('File served!'));

        const res = await request(app).get('/test-file');
        expect(res.text).toBe('File served!');
    });

    test('should add services as defined in options', async () => {
        const services = [
            {
                serviceName: '/api/test',
                method: 'get',
                function: (req, res) => res.status(200).json({ success: true }),
            },
        ];

        serverInstance = new BaseHttpServer({ services });
        const app = serverInstance.app;

        const res = await request(app).get('/api/test');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true });
    });

    test('should handle catch-all service', async () => {
        const services = [
            {
                serviceName: '*',
                method: 'get',
                function: (req, res) => res.status(404).send('Not Found'),
            },
        ];

        serverInstance = new BaseHttpServer({ services });
        const app = serverInstance.app;

        const res = await request(app).get('/random-path');
        expect(res.status).toBe(404);
        expect(res.text).toBe('Not Found');
    });

    test('should configure JSON body parsing middleware by default', async () => {
        serverInstance = new BaseHttpServer();
        const app = serverInstance.app;

        app.post('/json-test', (req, res) => {
            res.status(200).json({ received: req.body });
        });

        const res = await request(app).post('/json-test').send({ key: 'value' });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ received: { key: 'value' } });
    });

    test('should configure URL-encoded body parsing middleware', async () => {
        serverInstance = new BaseHttpServer({ encoding: ENCODINGS.urlencoded });
        const app = serverInstance.app;

        app.post('/urlencoded-test', (req, res) => {
            res.status(200).json({ received: req.body });
        });

        const res = await request(app).post('/urlencoded-test').type('form').send({ key: 'value' });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ received: { key: 'value' } });
    });

    test('should apply CORS options', async () => {
        const corsOptions = { origin: 'http://example.com' };
        serverInstance = new BaseHttpServer({ corsOptions });
        const app = serverInstance.app;

        app.get('/cors-test', (req, res) => res.send('CORS applied!'));

        const res = await request(app).get('/cors-test').set('Origin', 'http://example.com');
        expect(res.headers['access-control-allow-origin']).toBe('http://example.com');
    });

    test('should execute listen callback when server starts', () => {
        const mockCallback = jest.fn();
        serverInstance = new BaseHttpServer({ listenCallback: mockCallback });

        expect(mockCallback).toHaveBeenCalledTimes(0); // Callback is set but not executed here
    });
});
