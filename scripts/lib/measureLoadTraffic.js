'use strict';

const { performance } = require('node:perf_hooks');
const { verificationError } = require('./verificationError');

/** Measure the existing one-request-per-client schedule and own its listeners. */
async function measureLoadTraffic(clients, measurement, afterMessages) {
    let timer, failure, rejectReplies;
    const listeners = [];
    const fail = error => {
        if (!failure) failure = verificationError(error);
        rejectReplies(failure);
    };
    const sendNext = index => {
        if (failure) return;
        const id = measurement.next(index, performance.now());
        if (id !== null) clients[index].send(JSON.stringify({ type: 'echo', id }));
    };
    let startedAt;
    try {
        const replies = new Promise((resolve, reject) => {
            rejectReplies = reject;
            timer = setTimeout(() => fail(new Error('load responses timed out')), 30000);
            clients.forEach((client, index) => {
                const message = raw => {
                    if (failure) return;
                    try {
                        const reply = JSON.parse(String(raw));
                        if (measurement.receive(index, reply, performance.now())) resolve();
                        else sendNext(index);
                    } catch (error) { fail(error); }
                };
                const closed = () => {
                    if (measurement.received !== measurement.expectedMessages) fail(new Error('Load client closed before all replies arrived.'));
                };
                listeners.push({ client, message, closed });
                client.on('message', message); client.on('error', fail); client.on('close', closed);
            });
            startedAt = performance.now();
            try { clients.forEach((_client, index) => sendNext(index)); }
            catch (error) { fail(error); }
        });
        try { await replies; } finally { clearTimeout(timer); }
        const elapsedMs = performance.now() - startedAt;
        if (failure) throw failure;
        // Keep validation listeners active through the existing slow-client probe.
        // A duplicate arriving after the last expected reply must not be hidden
        // by an already-resolved promise.
        let contained;
        try { contained = await afterMessages(); }
        catch (error) {
            const probeFailure = verificationError(error);
            throw failure ? new AggregateError([failure, probeFailure], failure.message, { cause: failure }) : probeFailure;
        }
        if (failure) throw failure;
        return measurement.summarize(elapsedMs, contained);
    } finally {
        clearTimeout(timer);
        for (const { client, message, closed } of listeners) {
            client.off('message', message); client.off('error', fail); client.off('close', closed);
        }
    }
}

module.exports = { measureLoadTraffic };
