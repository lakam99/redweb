function listenServer(server, { port, bind, callback, logger = console, name = 'Server' }) {
    const onListening = callback || (() => logger?.log?.(`RedWeb ${name} listening on ${bind}:${port}`));
    server.listen(port, bind, onListening);
}

function closeServer(server) {
    return new Promise((resolve, reject) => {
        if (!server?.listening) return resolve();
        server.close((error) => error ? reject(error) : resolve());
    });
}

module.exports = { listenServer, closeServer };
