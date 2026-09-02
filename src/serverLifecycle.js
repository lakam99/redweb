function listenServer(server, { port, bind, callback, logger = console, name = 'Server' }) {
    const onListening = callback || (() => logger?.log?.(`RedWeb ${name} listening on ${bind}:${port}`));
    server.listen(port, bind, onListening);
}

function validateListenerOptions(options) {
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
        throw new TypeError('`port` must be an integer between 0 and 65535.');
    }
    if (typeof options.bind !== 'string' || !options.bind) {
        throw new TypeError('`bind` must be a non-empty string.');
    }
    if (typeof options.listen !== 'boolean') {
        throw new TypeError('`listen` must be a boolean.');
    }
    if (options.listenCallback !== undefined && typeof options.listenCallback !== 'function') {
        throw new TypeError('`listenCallback` must be a function.');
    }
}

async function settleTasks(tasks) {
    const results = await Promise.allSettled(tasks.map(task => Promise.resolve().then(task)));
    return results.filter(result => result.status === 'rejected').map(result => result.reason);
}

function throwCleanupErrors(errors, message) {
    if (!errors.length) return;
    const aggregate = new Error(message);
    aggregate.errors = errors;
    throw aggregate;
}

function closeServer(server) {
    return new Promise((resolve, reject) => {
        if (!server?.listening) return resolve();
        server.close((error) => error ? reject(error) : resolve());
    });
}

module.exports = {
    listenServer,
    closeServer,
    settleTasks,
    throwCleanupErrors,
    validateListenerOptions,
};
