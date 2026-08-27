function canSend(socket) {
    return Boolean(
        socket &&
        typeof socket.send === 'function' &&
        (socket.readyState === undefined || socket.readyState === 1 || socket.readyState === socket.OPEN)
    );
}

function sendPayload(socket, payload, policy) {
    if (!canSend(socket)) return false;
    if (policy && !policy.acceptsSend(socket, Buffer.byteLength(payload))) return false;
    try {
        socket.send(payload);
        return true;
    } catch {
        return false;
    }
}

function sendJson(socket, data, policy) {
    if (arguments.length < 3) {
        if (!canSend(socket)) return false;
        socket.send(JSON.stringify(data));
        return true;
    }
    return sendPayload(socket, JSON.stringify(data), policy);
}

function broadcast(sockets, data, policy) {
    const payload = JSON.stringify(data);
    let sent = 0;
    sockets.forEach((socket) => {
        if (sendPayload(socket, payload, policy)) sent += 1;
    });
    return sent;
}

module.exports = { sendJson, sendPayload, broadcast, canSend };
