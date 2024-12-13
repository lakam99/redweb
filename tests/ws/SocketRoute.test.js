const { WebSocketServer } = require('ws');
const SocketRoute = require('../../src/ws/SocketRoute');
const MockHandler = require('../__mocks__/MockBaseHandler');

// Mock WebSocketServer class
jest.mock('ws', () => ({
    WebSocketServer: jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        clients: new Set(),
    })),
}));

describe('SocketRoute', () => {
    let route;

    beforeEach(() => {
        route = new SocketRoute({
            path: '/test',
            handlers: [MockHandler],
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('should initialize with a valid path and handlers', () => {
        expect(route.path).toBe('/test');
        expect(route.handlers).toHaveLength(1);
        expect(route.handlers[0].name).toBe('MockHandler');
    });

    test('should throw an error if no path is provided', () => {
        expect(() => new SocketRoute({ handlers: [MockHandler] })).toThrow(
            'A `path` must be specified for the SocketRoute.'
        );
    });

    test('should throw an error if no handlers are provided', () => {
        expect(() => new SocketRoute({ path: '/nohandlers' })).toThrow(
            'At least one handler must be specified for the SocketRoute.'
        );
    });

    test('should add a new handler successfully', () => {
        class NewHandler {
            constructor() {
                this.name = 'NewHandler';
            }
        }

        route.addHandler(NewHandler);

        const addedHandler = route.handlers.find(handler => handler.name === 'NewHandler');
        expect(addedHandler).toBeDefined();
        expect(addedHandler.name).toBe('NewHandler');
    });

    test('should not add duplicate handlers', () => {
        const initialLength = route.handlers.length;

        class MockHandlerDuplicate {
            constructor() {
                this.name = 'MockHandler';
            }
        }

        route.addHandler(MockHandlerDuplicate);
        expect(route.handlers).toHaveLength(initialLength);
    });

    test('should handle a new WebSocket connection', () => {
        const mockSocket = { on: jest.fn(), send: jest.fn() };
        const mockReq = { socket: { remoteAddress: '127.0.0.1' } };

        route.handleConnection(mockSocket, mockReq);

        expect(route.clients.get('127.0.0.1')).toBe(mockSocket);
        expect(mockSocket.on).toHaveBeenCalledTimes(3); // 'message', 'close', 'error' listeners
    });

    test('should replace an existing connection with the same IP', () => {
        const mockSocket1 = { on: jest.fn(), send: jest.fn(), close: jest.fn() };
        const mockSocket2 = { on: jest.fn(), send: jest.fn() };
        const mockReq = { socket: { remoteAddress: '127.0.0.1' } };

        route.handleConnection(mockSocket1, mockReq);
        route.handleConnection(mockSocket2, mockReq);

        expect(route.clients.get('127.0.0.1')).toBe(mockSocket2);
        expect(mockSocket1.close).toHaveBeenCalled();
    });

    test('should handle messages and route to appropriate handler', () => {
        const mockSocket = { send: jest.fn() };
        const message = JSON.stringify({ type: 'MockHandler', data: { key: 'value' } });

        route.handleMessage(mockSocket, JSON.parse(message));

        expect(mockSocket.send).toHaveBeenCalledWith(
            JSON.stringify({ type: 'mockResponse', data: { type: 'MockHandler', data: { key: 'value' } } })
        );
    });

    test('should close the connection if no handler is found', () => {
        const mockSocket = { send: jest.fn(), close: jest.fn() };
        const invalidMessage = JSON.stringify({ type: 'NonExistentHandler', data: {} });

        route.handleMessage(mockSocket, JSON.parse(invalidMessage));

        expect(mockSocket.send).toHaveBeenCalledWith(
            JSON.stringify({ error: 'No such handler NonExistentHandler' })
        );
        expect(mockSocket.close).toHaveBeenCalled();
    });

    test('should handle disconnection and remove client', () => {
        const mockSocket = { on: jest.fn() };
        const mockReq = { socket: { remoteAddress: '127.0.0.1' } };

        route.handleConnection(mockSocket, mockReq);
        expect(route.clients.get('127.0.0.1')).toBe(mockSocket);

        route.handleClose(mockSocket, '127.0.0.1');
        expect(route.clients.has('127.0.0.1')).toBe(false);
    });
});
