function closeWebSocketServer(server, clients, timeoutMs) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) reject(error);
            else resolve();
        };

        const timer = setTimeout(() => {
            const errors = [];
            clients.forEach(socket => {
                try {
                    socket.terminate?.();
                } catch (error) {
                    errors.push(error);
                }
            });
            finish(errors[0]);
        }, timeoutMs);
        timer.unref();

        try {
            server.close(finish);
        } catch (error) {
            finish(error);
        }
    });
}

module.exports = { closeWebSocketServer };
