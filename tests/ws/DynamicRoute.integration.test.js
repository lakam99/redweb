const WebSocket = require('ws');
const { SocketServer, SocketRoute, BaseHandler } = require('../..');

const waitForListening = (socketServer) =>
  new Promise((resolve) => {
    if (socketServer.server.listening) return resolve();
    socketServer.server.once('listening', resolve);
  });

const waitForOpen = (ws) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for open')), 2000);
    ws.once('open', () => {
      clearTimeout(timeout);
      resolve();
    });
    ws.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

const ensureStaysOpen = (ws, ms = 200) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    ws.once('close', () => {
      clearTimeout(timer);
      reject(new Error('Socket closed unexpectedly'));
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

const shutdownServer = (socketServer) =>
  new Promise((resolve) => {
    if (!socketServer?.server) return resolve();
    socketServer.server.once('close', resolve);
    socketServer.shutdown();
  });

describe('SocketServer dynamic route (integration)', () => {
  test('client stays connected after adding a route at runtime', async () => {
    class NoopHandler extends BaseHandler {
      constructor() {
        super('noop');
      }
      onMessage() {}
    }

    class DynamicRoute extends SocketRoute {
      constructor() {
        super({
          path: '/dynamic',
          handlers: [NoopHandler],
          allowDuplicateConnections: true,
        });
      }
    }

    const socketServer = new SocketServer({ port: 0 });
    socketServer.addRoute(DynamicRoute);
    await waitForListening(socketServer);

    const dynamicRoute = socketServer.routes.find((route) => route.path === '/dynamic');
    const port = socketServer.server.address().port;
    const client = new WebSocket(`ws://127.0.0.1:${port}/dynamic`);

    const waitForServerSideClose = () => {
      if (!dynamicRoute) return Promise.resolve();
      const first = dynamicRoute.clients.values().next();
      const socket = first && first.value;
      if (!socket || typeof socket.once !== 'function') return Promise.resolve();
      return new Promise((resolve) => socket.once('close', resolve));
    };

    try {
      await waitForOpen(client);
      await ensureStaysOpen(client, 300);
      expect(client.readyState).toBe(WebSocket.OPEN);
    } finally {
      const serverSocketClosed = waitForServerSideClose();
      await new Promise((resolve, reject) => {
        if (client.readyState === WebSocket.CLOSED) return resolve();
        const timeout = setTimeout(() => reject(new Error('Timed out closing client')), 1000);
        client.once('close', () => {
          clearTimeout(timeout);
          resolve();
        });
        client.close();
      });
      await serverSocketClosed;
      await shutdownServer(socketServer);
    }
  });
});
