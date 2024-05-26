const RedWeb = require('redweb');

// HTTP server on port 80
new RedWeb.HttpServer({
    port: 80,
    services: [
        {
            serviceName: '/test',
            method: RedWeb.METHODS.GET,
            function: (req, res) => res.send('<h1>Goodbye~!</h1>')
        }
    ]
});

// WebSocket server on port 3000
new RedWeb.SocketServer({messageHandlers: {'msg': function (data) {console.log(data); this.send('guuuuuurl')}}});
