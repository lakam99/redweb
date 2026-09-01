'use strict';

const assert = require('node:assert/strict');
const modes = new Set(['legacy', 'context', 'transport', 'heartbeat', 'rooms', 'sessions', 'drain', 'protocol', 'enabled']);

/** Input and result policy only; does not sample, tune, or retry measurements. */
class MemoryMeasurement {
    constructor(environment = process.env) {
        this.count = MemoryMeasurement.count(environment.REDWEB_MEMORY_CLIENTS ?? 500);
        this.trials = Number(environment.REDWEB_MEMORY_TRIALS ?? 3);
        this.maximumBytes = Number(environment.REDWEB_MEMORY_MAX_BYTES ?? 2048);
        assert(Number.isSafeInteger(this.trials) && this.trials >= 3 && Number.isSafeInteger(this.trials * 2),
            'REDWEB_MEMORY_TRIALS must be at least 3 with a safe trial count.');
        assert(Number.isFinite(this.maximumBytes) && this.maximumBytes >= 1,
            'REDWEB_MEMORY_MAX_BYTES must be positive.');
    }

    static count(value) {
        const count = Number(value);
        assert(Number.isSafeInteger(count) && count > 0 && Number.isSafeInteger(count + 1),
            'Memory client count must be a positive safe integer with capacity for one extra connection.');
        return count;
    }

    static mode(value) {
        assert(modes.has(value), 'Unsupported memory measurement mode.');
        return value;
    }

    decode(output, mode) {
        const value = JSON.parse(output);
        assert(value && typeof value === 'object' && !Array.isArray(value), 'Invalid memory worker result.');
        assert.deepEqual(Object.keys(value).sort(), ['bytesPerConnection', 'count', 'heapDelta', 'mode']);
        assert.equal(value.mode, MemoryMeasurement.mode(mode), 'Memory worker mode mismatch.');
        assert.equal(value.count, this.count, 'Memory worker count mismatch.');
        assert(Number.isSafeInteger(value.heapDelta), 'Invalid memory heap delta.');
        assert(Number.isFinite(value.bytesPerConnection), 'Invalid per-connection memory value.');
        assert.equal(value.bytesPerConnection, value.heapDelta / this.count, 'Inconsistent memory worker result.');
        return value;
    }

    summarize(measurements) {
        const median = values => {
            assert(Array.isArray(values) && values.length === this.trials && values.every(Number.isFinite),
                'Missing or invalid memory trials.');
            return [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
        };
        const result = { connections: this.count, trials: this.trials,
            legacyBytesPerConnection: median(measurements.legacy),
            enabledBytesPerConnection: median(measurements.enabled),
            maximumFrameworkMetadataBytesPerConnection: this.maximumBytes };
        result.frameworkMetadataBytesPerConnection = result.enabledBytesPerConnection - result.legacyBytesPerConnection;
        assert(Number.isFinite(result.frameworkMetadataBytesPerConnection), 'Invalid memory comparison.');
        return result;
    }
}

module.exports = { MemoryMeasurement };
