const { Server } = require('http');
const { BaseSocketServer, SOCKET_OPTIONS } = require('../../src/ws/BaseSocketServer');
const SocketRoute = require('../../src/ws/SocketRoute');
const MockHandler = require('../__mocks__/MockBaseHandler');
const DefaultRoute = require('../../src/ws/DefaultRoute');

// Mock the WebSocket Server class
jest.mock('ws', () => ({
    WebSocketServer: jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        handleUpgrade: jest.fn(),
        emit: jest.fn()
    }))
}));

describe('BaseSocketServer', () => {
    let httpServer, socketServer;

    beforeEach(() => {
        httpServer = new Server();
        socketServer = new BaseSocketServer(httpServer, {
            port: 3000,
            routes: [class TestRoute extends SocketRoute {
                constructor() {
                    super({
                        path: '/test',
                        handlers: [MockHandler]
                    });
                }
            }]
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('should initialize with default options', () => {
        const defaultServer = new BaseSocketServer(httpServer, {routes: [DefaultRoute]});
        expect(defaultServer.port).toBe(SOCKET_OPTIONS.port);
    });

    test('should initialize with provided routes', () => {
        expect(socketServer.routes).toHaveLength(1);
        expect(socketServer.routes[0].path).toBe('/test');
    });

    test('should handle WebSocket upgrade with matching route', () => {
        const mockReq = { url: '/test' };
        const mockSock = { destroy: jest.fn() };
        const mockHead = {};

        const route = socketServer.routes[0];
        route.server.handleUpgrade = jest.fn();

        socketServer.handleUpgrade(mockReq, mockSock, mockHead);

        expect(route.server.handleUpgrade).toHaveBeenCalledWith(
            mockReq,
            mockSock,
            mockHead,
            expect.any(Function)
        );
    });

    test('should reject WebSocket upgrade with no matching route', () => {
        const mockReq = { url: '/invalid' };
        const mockSock = { destroy: jest.fn() };
        const mockHead = {};

        socketServer.handleUpgrade(mockReq, mockSock, mockHead);

        expect(mockSock.destroy).toHaveBeenCalled();
    });
});
