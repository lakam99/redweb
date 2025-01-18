const request = require('supertest'); // For testing HTTP routes
const path = require('path');
const fs = require('fs');
const { BaseHttpServer, ENCODINGS, HTTP_OPTIONS } = require('../../src/http/BaseHttpServer');

describe('BaseHttpServer', () => {
    let serverInstance;
    const serverRoot = require.main?.filename
        ? path.dirname(require.main.filename)
        : process.cwd(); // Handle Jest null `require.main`

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

    test('should dynamically render pages from the pages directory', async () => {
        const testPagePath = path.resolve(serverRoot, 'pages/testPage.js');

        jest.spyOn(fs, 'existsSync').mockImplementation((filePath) => filePath === testPagePath);
        jest.doMock(testPagePath, () => () => '<h1>Dynamic Page Rendered</h1>', { virtual: true });

        serverInstance = new BaseHttpServer();
        const app = serverInstance.app;

        const res = await request(app).get('/testPage');
        expect(res.status).toBe(200);
        expect(res.text).toBe('<h1>Dynamic Page Rendered</h1>');
    });

    test('should handle 404 if dynamic page is not found', async () => {
        jest.spyOn(fs, 'existsSync').mockReturnValue(false);

        serverInstance = new BaseHttpServer();
        const app = serverInstance.app;

        const res = await request(app).get('/nonexistent-page');
        expect(res.status).toBe(404);
        expect(res.text).toBe('<h1>Page Not Found</h1>');
    });
});
