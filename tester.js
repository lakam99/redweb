const {SocketServer, HttpServer, METHODS} = require('./index');

// HTTP server on port 80
new HttpServer({
    port: 80,
    publicPaths: ['test-public'],
    services: [
        {
            serviceName: '/test',
            method: METHODS.GET,
            function: (req, res) => res.send('<h1>Goodbye~!</h1>')
        }
    ]
});

// WebSocket server on port 3000
new SocketServer({messageHandlers: {'msg': function (socket, data) {console.log(data); socket.send('guuuuuurl')}}});
