function canSend(socket) {
    return Boolean(
        socket &&
        typeof socket.send === 'function' &&
        (socket.readyState === undefined || socket.readyState === 1 || socket.readyState === socket.OPEN)
    );
}

function sendJson(socket, data) {
    if (!canSend(socket)) return false;
    socket.send(JSON.stringify(data));
    return true;
}

function broadcast(sockets, data) {
    const payload = JSON.stringify(data);
    let sent = 0;
    sockets.forEach((socket) => {
        if (!canSend(socket)) return;
        try {
            socket.send(payload);
            sent += 1;
        } catch {
            // A socket can close between the ready-state check and send.
        }
    });
    return sent;
}

module.exports = { sendJson, broadcast, canSend };
