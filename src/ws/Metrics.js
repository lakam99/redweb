class Metrics {
    constructor(sink, routePath, logger = console) {
        if (!sink || typeof sink !== 'object' || Array.isArray(sink)) {
            throw new TypeError('`metrics` must be an object.');
        }
        ['increment', 'gauge', 'observe'].forEach(method => {
            if (sink[method] !== undefined && typeof sink[method] !== 'function') {
                throw new TypeError(`\`metrics.${method}\` must be a function.`);
            }
        });
        if (!['increment', 'gauge', 'observe'].some(method => typeof sink[method] === 'function')) {
            throw new TypeError('`metrics` requires at least one metric method.');
        }
        this.sink = sink;
        this.attributes = Object.freeze({ route: routePath });
        this.logger = logger;
    }

    emit(method, name, value = 1) {
        if (typeof this.sink[method] !== 'function') return;
        try {
            Promise.resolve(this.sink[method](name, value, this.attributes))
                .catch(error => this.logger?.error?.('Metrics sink failed:', error));
        } catch (error) {
            this.logger?.error?.('Metrics sink failed:', error);
        }
    }

    increment(name, value) { this.emit('increment', name, value); }
    gauge(name, value) { this.emit('gauge', name, value); }
    observe(name, value) { this.emit('observe', name, value); }
}

module.exports = Metrics;
