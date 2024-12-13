function sendJson(socket, data) {
    socket.send(JSON.stringify(data));
}

function broadcast(sockets, data) {
    sockets.forEach(socket => sendJson(socket, data));
}

module.exports = { sendJson, broadcast }
