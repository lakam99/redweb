export function sendJson(socket, data) {
    socket.send(JSON.stringify(data));
}
