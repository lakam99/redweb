const { Server } = require('http');
const { BaseSocketServer, SOCKET_OPTIONS } = require('../../src/ws/BaseSocketServer');
const MockWebSocket = require('../__mocks__/MockWebSocket');

// Mock the WebSocket Server class
jest.mock('ws', () => ({
    Server: jest.fn().mockImplementation(() => ({
        on: jest.fn(),
    })),
}));

describe('BaseSocketServer', () => {
    let httpServer, socketServer;

    beforeEach(() => {
        httpServer = new Server();
        socketServer = new BaseSocketServer(httpServer, {
            port: 3000,
            messageHandlers: {
                test: (socket, data) => socket.send(JSON.stringify({ type: 'testResponse', data })),
            },
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('should initialize with default options', () => {
        const defaultServer = new BaseSocketServer(httpServer);
        expect(defaultServer.port).toBe(SOCKET_OPTIONS.port);
        expect(defaultServer.messageHandlers.ping).toBeDefined();
    });

    test('should handle new connections', () => {
        const mockSocket = new MockWebSocket();
        const mockReq = { socket: { remoteAddress: '127.0.0.1' } };

        socketServer.handleConnection(mockSocket, mockReq);

        expect(socketServer.clients.get('127.0.0.1')).toBe(mockSocket);
        expect(mockSocket.listeners['message']).toBeDefined();
        expect(mockSocket.listeners['close']).toBeDefined();
        expect(mockSocket.listeners['error']).toBeDefined();
    });

    test('should close existing connection if a new one with the same IP connects', () => {
        const mockSocket1 = new MockWebSocket();
        const mockSocket2 = new MockWebSocket();
        const mockReq = { socket: { remoteAddress: '127.0.0.1' } };

        socketServer.handleConnection(mockSocket1, mockReq);
        socketServer.handleConnection(mockSocket2, mockReq);

        expect(mockSocket1.readyState).toBe(MockWebSocket.CLOSED);
        expect(socketServer.clients.get('127.0.0.1')).toBe(mockSocket2);
    });

    test('should process an initial message and assign a handler', () => {
        const mockSocket = new MockWebSocket();
        const mockHandler = { name: 'TestHandler', newConnection: jest.fn() };
        socketServer.handlers = [mockHandler];

        const initialMessage = JSON.stringify({ type: '__handlerConnect', data: { handlerName: 'TestHandler' } });
        socketServer.initialMessageHandler(mockSocket, initialMessage, '127.0.0.1');

        expect(mockHandler.newConnection).toHaveBeenCalledWith(mockSocket, { handlerName: 'TestHandler' });
    });

    test('should broadcast a message to all connected clients', () => {
        const mockSocket1 = new MockWebSocket();
        mockSocket1.send = jest.fn();
        const mockSocket2 = new MockWebSocket();
        mockSocket2.send = jest.fn();
        socketServer.clients.set('127.0.0.1', mockSocket1);
        socketServer.clients.set('127.0.0.2', mockSocket2);

        const message = { type: 'broadcast', data: 'Hello World' };
        socketServer.broadcast(message);

        expect(mockSocket1.send).toHaveBeenCalledWith(JSON.stringify(message));
        expect(mockSocket2.send).toHaveBeenCalledWith(JSON.stringify(message));
    });

    test('should add a new handler dynamically', () => {
        class DynamicHandler {
            constructor() {
                this.name = 'DynamicHandler';
                this.newConnection = jest.fn();
            }
        }

        socketServer.addHandler(DynamicHandler);

        const addedHandler = socketServer.handlers.find(handler => handler.name === 'DynamicHandler');
        expect(addedHandler).toBeDefined();
        expect(addedHandler.name).toBe('DynamicHandler');
    });

    test('should process a message with dynamically added handler', () => {
        class DynamicHandler {
            constructor() {
                this.name = 'DynamicHandler';
                this.newConnection = jest.fn();
            }
        }

        socketServer.addHandler(DynamicHandler);

        const mockSocket = new MockWebSocket();
        const initialMessage = JSON.stringify({
            type: '__handlerConnect',
            data: { handlerName: 'DynamicHandler' },
        });

        const addedHandler = socketServer.handlers.find(handler => handler.name === 'DynamicHandler');
        addedHandler.newConnection = jest.fn();

        socketServer.initialMessageHandler(mockSocket, initialMessage, '127.0.0.1');

        expect(addedHandler.newConnection).toHaveBeenCalledWith(mockSocket, { handlerName: 'DynamicHandler' });
    });
});
