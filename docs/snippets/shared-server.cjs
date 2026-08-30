const { HttpServer, SocketServer, SocketRoute, BaseHandler, METHODS } = require('redweb')

class Hello extends BaseHandler {
  constructor() { super('hello') }
  onMessage(socket) { socket.sendJson({ type: 'hello', message: 'Hello from the server!' }) }
}

class ChatRoute extends SocketRoute {
  constructor() { super({ path: '/chat', handlers: [Hello] }) }
}

function createApp(port = 3030) {
  const http = new HttpServer({
    listen: false,
    services: [{ serviceName: '/health', method: METHODS.GET, function: (_req, res) => res.json({ ok: true }) }],
  })
  const sockets = new SocketServer({
    server: http.server,
    routes: [ChatRoute],
  })
  http.server.listen(port, '127.0.0.1')
  return { http, sockets, async shutdown() { await sockets.shutdown(); await http.shutdown() } }
}

if (require.main === module) {
  const app = createApp()
  process.once('SIGTERM', () => app.shutdown().catch(console.error))
}
module.exports = { createApp }
