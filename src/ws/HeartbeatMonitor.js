const { performance } = require('perf_hooks');

function acknowledgePong() {
    const state = this.__redwebHeartbeatState;
    if (!state) return;
    state.awaitingPong = false;
    if (state.terminationTimer) {
        clearTimeout(state.terminationTimer);
        state.terminationTimer = null;
    }
}

class HeartbeatMonitor {
    constructor({ intervalMs, timeoutMs }, logger = console, clock = () => performance.now()) {
        if (!Number.isInteger(intervalMs) || intervalMs < 1) {
            throw new TypeError('`heartbeat.intervalMs` must be a positive integer.');
        }
        if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
            throw new TypeError('`heartbeat.timeoutMs` must be a positive integer.');
        }
        if (typeof clock !== 'function') throw new TypeError('`clock` must be a function.');
        this.intervalMs = intervalMs;
        this.timeoutMs = timeoutMs;
        this.logger = logger;
        this.clock = clock;
        this.sockets = new Map();
        this.timer = setInterval(() => this.tick(), Math.min(intervalMs, timeoutMs));
        this.timer.unref();
    }

    attach(socket) {
        this.detach(socket);
        const state = { awaitingPong: false, lastPing: null, terminationTimer: null };
        socket.__redwebHeartbeatState = state;
        this.sockets.set(socket, state);
        socket.on('pong', acknowledgePong);
    }

    detach(socket) {
        const state = this.sockets.get(socket);
        if (!state) return false;
        if (state.terminationTimer) clearTimeout(state.terminationTimer);
        state.terminationTimer = null;
        socket.off?.('pong', acknowledgePong);
        delete socket.__redwebHeartbeatState;
        this.sockets.delete(socket);
        return true;
    }

    tick() {
        const now = this.clock();
        this.sockets.forEach((state, socket) => {
            if (state.awaitingPong && now - state.lastPing >= this.timeoutMs) {
                this.scheduleTermination(socket, state);
                return;
            }
            if (!state.awaitingPong && (state.lastPing === null || now - state.lastPing >= this.intervalMs)) {
                state.lastPing = now;
                state.awaitingPong = true;
                try {
                    socket.ping?.();
                } catch (error) {
                    this.logger?.error?.('Error pinging socket:', error);
                }
            }
        });
    }

    scheduleTermination(socket, state) {
        if (state.terminationTimer) return;
        // Give an already-sent pong one full timeout window to reach JavaScript.
        // This prevents a delayed server event loop from blaming a responsive peer.
        state.terminationTimer = setTimeout(() => {
            state.terminationTimer = null;
            this.detach(socket);
            try {
                socket.terminate?.();
            } catch (error) {
                this.logger?.error?.('Error terminating unresponsive socket:', error);
            }
        }, this.timeoutMs);
        state.terminationTimer.unref();
    }

    stop() {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
        [...this.sockets.keys()].forEach(socket => this.detach(socket));
    }
}

module.exports = HeartbeatMonitor;
