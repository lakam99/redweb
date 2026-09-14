'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const median = values => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];

function trend(samples, key, allowedGrowth) {
    const values = samples.map(sample => sample[key]);
    const windowSize = Math.max(1, Math.floor(values.length / 5));
    const early = median(values.slice(0, windowSize)), late = median(values.slice(-windowSize));
    const delta = late - early;
    const monotonicIncrease = values.every((value, index) => index === 0 || value >= values[index - 1]) && delta > allowedGrowth;
    return { early, late, delta, peak: values.reduce((peak, value) => Math.max(peak, value), 0), allowedGrowth,
        monotonicIncrease, passed: delta <= allowedGrowth && !monotonicIncrease };
}

/** Configuration and evidence policy; does not own transports or change sampling. */
class SoakMeasurement {
    constructor(environment = process.env, outputPath) {
        this.durationSeconds = Number(environment.REDWEB_SOAK_SECONDS ?? 3600);
        this.clientCount = Number(environment.REDWEB_SOAK_CLIENTS ?? 64);
        this.sampleSeconds = Number(environment.REDWEB_SOAK_SAMPLE_SECONDS ?? 5);
        assert(Number.isFinite(this.durationSeconds) && this.durationSeconds >= 10 && this.durationSeconds * 1000 <= 2147483647,
            'REDWEB_SOAK_SECONDS must be at least 10 and fit a native timer.');
        assert(Number.isSafeInteger(this.clientCount) && this.clientCount >= 2 && this.clientCount <= 4294967295 && Number.isSafeInteger(this.clientCount * 8),
            'REDWEB_SOAK_CLIENTS must be a safe array capacity of at least 2.');
        // One extra tick allows the initial synchronous sample before the duration timer starts.
        assert(Number.isSafeInteger((Math.ceil(this.durationSeconds * 10) + 1) * this.clientCount),
            'Soak duration and clients exceed safe delivery-counter capacity.');
        assert(Number.isFinite(this.sampleSeconds) && this.sampleSeconds >= 1 && this.sampleSeconds <= this.durationSeconds / 2,
            'REDWEB_SOAK_SAMPLE_SECONDS must allow at least two active-phase samples.');
        assert(outputPath === undefined || path.isAbsolute(outputPath), 'The soak output path must be absolute.');
    }

    summarize(samples, { sent, received }, handlesBefore, handlesAfter) {
        assert(samples.length >= 4, 'Insufficient active-phase soak samples.');
        const keys = ['heapUsed', 'clients', 'rooms', 'sessions', 'inFlight', 'queued', 'listeners', 'ownedTimers', 'handles'];
        samples.forEach((sample, index) => {
            assert(keys.every(key => Number.isSafeInteger(sample[key]) && sample[key] >= 0) && sample.heapUsed > 0,
                'Invalid soak resource sample.');
            assert(Number.isFinite(sample.elapsedSeconds) && sample.elapsedSeconds >= 0 &&
                (index === 0 || sample.elapsedSeconds >= samples[index - 1].elapsedSeconds), 'Invalid soak sample chronology.');
        });
        assert(Number.isSafeInteger(sent) && sent > 0 && Number.isSafeInteger(received) && received >= 0 && received <= sent,
            'Invalid soak delivery counts.');
        assert([handlesBefore, handlesAfter].every(value => Number.isSafeInteger(value) && value >= 0), 'Invalid soak handle counts.');
        const warmed = samples.slice(1, Math.max(2, Math.ceil(samples.length / 3))).map(entry => entry.heapUsed);
        const warmHeap = median(warmed);
        const final = samples[samples.length - 1];
        const trendInput = samples.slice(Math.max(1, Math.floor((samples.length - 1) / 3)), -1);
        const budgets = { heapUsed: warmHeap * 0.10, clients: 1, rooms: 0, sessions: 4, inFlight: 4, queued: 4, listeners: 8, ownedTimers: 0 };
        const trends = Object.fromEntries(Object.entries(budgets).map(([key, budget]) => [key, trend(trendInput, key, budget)]));
        return { durationSeconds: this.durationSeconds, clientCount: this.clientCount,
            messagesSent: sent, messagesReceived: received, messagesMissing: sent - received, deliveryPercent: received / sent * 100,
            samples: samples.length, warmHeap, peakHeap: samples.reduce((peak, sample) => Math.max(peak, sample.heapUsed), 0),
            finalHeap: final.heapUsed, finalHeapPercentOfWarm: final.heapUsed / warmHeap * 100,
            finalRegistries: { clients: final.clients, rooms: final.rooms, sessions: final.sessions, inFlight: final.inFlight },
            trends, handlesBefore, handlesAfter };
    }

    passed(result) {
        return Object.values(result.finalRegistries).every(value => value === 0) &&
            Object.values(result.trends).every(value => value.passed) && BigInt(result.messagesReceived) * 100n >= BigInt(result.messagesSent) * 99n &&
            BigInt(result.finalHeap) * 10n <= BigInt(result.warmHeap) * 11n && result.handlesAfter <= result.handlesBefore + 1;
    }
}

module.exports = { SoakMeasurement };
