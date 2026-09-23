'use strict';

/** Tracks only a caller-owned listener, including pre-HTTP/pre-TLS TCP peers. */
class OwnedServerLifecycle {
    constructor(server) {
        this.server = server;
        this.connections = new Set();
        this.forced = false;
        this.onEmpty = null;
        this.onConnection = socket => {
            this.connections.add(socket);
            socket.once('close', () => {
                this.connections.delete(socket);
                this.onEmpty?.();
            });
            if (this.forced) socket.destroy();
        };
        this.dispose = () => {
            server.off('connection', this.onConnection);
            server.off('close', this.dispose);
        };
        server.on('connection', this.onConnection);
        server.once('close', this.dispose);
    }

    forceClose() {
        this.forced = true;
        const errors = [];
        // A failed/non-cooperating close callback must not leave admission open.
        if (this.server.listening) {
            try { this.server.close(); } catch (error) { errors.push(error); }
        }
        for (const socket of this.connections) {
            try { socket.destroy(); } catch (error) { errors.push(error); }
        }
        return errors;
    }

    close(timeoutMs, closeCallback) {
        let timer;
        const empty = new Promise(resolve => {
            this.onEmpty = () => { if (this.connections.size === 0) resolve(); };
        });
        const closing = Promise.resolve().then(closeCallback).catch(error => {
            const cleanup = this.forceClose();
            if (cleanup.length) throw new AggregateError([error, ...cleanup], error.message, { cause: error });
            throw error;
        });
        const timeout = new Promise((resolve, reject) => {
            timer = setTimeout(() => {
                const errors = this.forceClose();
                if (errors.length) reject(new AggregateError(errors, 'Owned listener force-close failed.'));
                else resolve();
            }, timeoutMs);
        });
        this.onEmpty();
        return Promise.race([Promise.all([closing, empty]), timeout]).then(() => undefined).finally(() => {
            clearTimeout(timer);
            this.onEmpty = null;
            // Retain the forced-peer guard until native close when peers remain.
            if (!this.server.listening && this.connections.size === 0) this.dispose();
        });
    }
}

module.exports = OwnedServerLifecycle;
