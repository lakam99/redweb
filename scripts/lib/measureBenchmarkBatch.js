'use strict';

const { performance } = require('node:perf_hooks');
const { verificationError } = require('./verificationError');

/** Own the listeners and deadline for one windowed benchmark phase. */
async function measureBenchmarkBatch(socket, batch) {
    let timer, failure, rejectReplies, resolveReplies, elapsedMs;
    const startedAt = performance.now();
    const fail = error => {
        if (!failure) failure = verificationError(error);
        rejectReplies(failure);
    };
    const send = () => {
        while (!failure) {
            const id = batch.next(performance.now());
            if (id === null) return;
            socket.send(JSON.stringify({ type: 'echo', id }));
        }
    };
    const message = raw => {
        if (failure) return;
        try {
            const reply = JSON.parse(String(raw));
            if (batch.receive(reply, performance.now())) {
                elapsedMs = performance.now() - startedAt;
                resolveReplies();
            } else send();
        } catch (error) { fail(error); }
    };
    const closed = () => {
        if (batch.received !== batch.count) fail(new Error('Benchmark peer closed before all replies arrived.'));
    };
    try {
        const replies = new Promise((resolve, reject) => {
            resolveReplies = resolve; rejectReplies = reject;
            timer = setTimeout(() => fail(new Error('Benchmark responses timed out.')), 30000);
            socket.on('message', message); socket.on('error', fail); socket.on('close', closed);
            try { send(); } catch (error) { fail(error); }
        });
        await replies;
        if (failure) throw failure;
        return batch.summarize(elapsedMs);
    } finally {
        clearTimeout(timer);
        socket.off('message', message); socket.off('error', fail); socket.off('close', closed);
    }
}

module.exports = { measureBenchmarkBatch };
