const request = require('supertest');
const { BaseHttpServer, HttpServer, METHODS } = require('../..');

const closeServer = (server) =>
    new Promise((resolve, reject) => {
        if (!server?.server?.listening) return resolve();
        server.server.close((error) => (error ? reject(error) : resolve()));
    });

describe('HttpServer', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('listen false builds an Express app without binding a port', async () => {
        const server = new HttpServer({
            listen: false,
            services: [
                {
                    serviceName: '/health',
                    method: METHODS.GET,
                    function: (req, res) => res.json({ ok: true }),
                },
            ],
        });

        expect(server.app).toBeDefined();
        expect(server.server).toBeUndefined();

        const res = await request(server.app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
    });

    test('exports BaseHttpServer for advanced composition', () => {
        expect(BaseHttpServer).toBeDefined();
        expect(new BaseHttpServer().app).toBeDefined();
    });

    test('listens by default when given a port', async () => {
        const server = new HttpServer({ port: 0 });

        try {
            expect(server.server).toBeDefined();
            expect(server.server.listening).toBe(true);
        } finally {
            await closeServer(server);
        }
    });
});
