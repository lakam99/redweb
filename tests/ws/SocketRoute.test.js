const { WebSocketServer } = require('ws');
const SocketRoute = require('../../src/ws/SocketRoute');
const { BaseHandler } = require('../../src/ws/BaseHandler');
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

    test('should pass websocketOptions to WebSocketServer', () => {
        new SocketRoute({
            path: '/limited',
            handlers: [MockHandler],
            websocketOptions: {
                maxPayload: 1024,
                perMessageDeflate: false,
            },
        });

        expect(WebSocketServer).toHaveBeenLastCalledWith({
            closeTimeout: 5000,
            noServer: true,
            maxPayload: 1024,
            perMessageDeflate: false,
        });
    });

    test('should throw an error if no path is provided', () => {
        expect(() => new SocketRoute({ handlers: [MockHandler] })).toThrow(
            'A `path` beginning with "/" must be specified for the SocketRoute.'
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

    test('should handle messages and route to appropriate handler', async () => {
        const mockSocket = { send: jest.fn() };
        const message = JSON.stringify({ type: 'MockHandler', data: { key: 'value' } });

        await route.handleMessage(mockSocket, JSON.parse(message));

        expect(mockSocket.send).toHaveBeenCalledWith(
            JSON.stringify({ type: 'mockResponse', data: { type: 'MockHandler', data: { key: 'value' } } })
        );
    });

    test('should route JSON socket messages to appropriate handler', async () => {
        const mockSocket = { on: jest.fn(), send: jest.fn(), close: jest.fn() };
        const mockReq = { socket: { remoteAddress: '127.0.0.1' } };

        route.handleConnection(mockSocket, mockReq);
        const messageHandler = mockSocket.on.mock.calls.find(([event]) => event === 'message')[1];

        messageHandler(JSON.stringify({ type: 'MockHandler', data: { key: 'value' } }), false);
        await new Promise(setImmediate);

        expect(mockSocket.send).toHaveBeenCalledWith(
            JSON.stringify({ type: 'mockResponse', data: { type: 'MockHandler', data: { key: 'value' } } })
        );
    });

    test('should route binary socket messages to onBinaryMessage without parsing JSON', async () => {
        class BinaryHandler extends BaseHandler {
            constructor() {
                super('BinaryHandler');
            }

            onMessage() {
                throw new Error('JSON handler should not be called for binary messages');
            }

            onBinaryMessage(socket, buffer) {
                socket.sendJson({ type: 'binaryResponse', length: buffer.length });
            }
        }

        const binaryRoute = new SocketRoute({
            path: '/binary',
            handlers: [BinaryHandler],
        });
        const mockSocket = { on: jest.fn(), send: jest.fn(), close: jest.fn() };
        const mockReq = { socket: { remoteAddress: '127.0.0.1' } };

        binaryRoute.handleConnection(mockSocket, mockReq);
        const messageHandler = mockSocket.on.mock.calls.find(([event]) => event === 'message')[1];

        messageHandler(Buffer.from([0xff, 0x00]), true);
        await new Promise(setImmediate);

        expect(mockSocket.send).toHaveBeenCalledWith(
            JSON.stringify({ type: 'binaryResponse', length: 2 })
        );
        expect(mockSocket.close).not.toHaveBeenCalled();
    });

    test('should send an error for unsupported binary messages without closing the socket', async () => {
        const mockSocket = {
            send: jest.fn(),
            sendJson(data) {
                this.send(JSON.stringify(data));
            },
            close: jest.fn(),
        };

        await route.handleBinaryMessage(mockSocket, Buffer.from([0x01]));

        expect(mockSocket.send).toHaveBeenCalledWith(
            JSON.stringify({ error: 'Binary messages are not supported by this handler' })
        );
        expect(mockSocket.close).not.toHaveBeenCalled();
    });

    test('should use acceptsBinary to select a binary handler', async () => {
        class JsonHandler extends BaseHandler {
            constructor() {
                super('JsonHandler');
            }

            acceptsBinary() {
                return false;
            }

            onMessage() {}

            onBinaryMessage() {
                throw new Error('Non-accepting handler should not receive binary messages');
            }
        }

        class AcceptedBinaryHandler extends BaseHandler {
            constructor() {
                super('AcceptedBinaryHandler');
            }

            acceptsBinary() {
                return true;
            }

            onMessage() {}

            onBinaryMessage(socket, buffer) {
                socket.sendJson({ type: 'acceptedBinary', length: buffer.length });
            }
        }

        const binaryRoute = new SocketRoute({
            path: '/accepted-binary',
            handlers: [JsonHandler, AcceptedBinaryHandler],
        });
        const mockSocket = {
            send: jest.fn(),
            sendJson(data) {
                this.send(JSON.stringify(data));
            },
            close: jest.fn(),
        };

        await binaryRoute.handleBinaryMessage(mockSocket, Buffer.from([0x01, 0x02, 0x03]));

        expect(mockSocket.send).toHaveBeenCalledWith(
            JSON.stringify({ type: 'acceptedBinary', length: 3 })
        );
        expect(mockSocket.close).not.toHaveBeenCalled();
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
        const mockSocket = { on: jest.fn(), send: jest.fn(), close: jest.fn() };
        const mockReq = { socket: { remoteAddress: '127.0.0.1' } };

        route.handleConnection(mockSocket, mockReq);
        expect(route.clients.get('127.0.0.1')).toBe(mockSocket);

        route.handleClose(mockSocket);
        expect(route.clients.has('127.0.0.1')).toBe(false);
    });

    test('should remove duplicate-allowed clients by their stored client key', () => {
        const duplicateRoute = new SocketRoute({
            path: '/duplicates',
            handlers: [MockHandler],
            allowDuplicateConnections: true,
        });
        const socket1 = { on: jest.fn(), send: jest.fn(), close: jest.fn() };
        const socket2 = { on: jest.fn(), send: jest.fn(), close: jest.fn() };
        const mockReq = { socket: { remoteAddress: '127.0.0.1' } };

        duplicateRoute.handleConnection(socket1, mockReq);
        duplicateRoute.handleConnection(socket2, mockReq);

        expect(duplicateRoute.clients.size).toBe(2);
        expect(socket1.clientKey).toBeDefined();
        expect(socket2.clientKey).toBeDefined();

        duplicateRoute.handleClose(socket1);

        expect(duplicateRoute.clients.size).toBe(1);
        expect([...duplicateRoute.clients.values()]).toEqual([socket2]);
    });

    test('should not drop a replacement client when the old one closes later', () => {
        const oldSocket = { on: jest.fn(), send: jest.fn(), close: jest.fn() };
        const newSocket = { on: jest.fn(), send: jest.fn(), close: jest.fn() };
        const mockReq = { socket: { remoteAddress: '127.0.0.1' } };

        route.handleConnection(oldSocket, mockReq);
        route.handleConnection(newSocket, mockReq);

        expect(route.clients.get('127.0.0.1')).toBe(newSocket);

        // Simulate the old socket closing after replacement
        route.handleClose(oldSocket);
        expect(route.clients.get('127.0.0.1')).toBe(newSocket);
    });
});
