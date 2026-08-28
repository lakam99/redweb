function synchronous(result, message) {
    if (result && typeof result.then === 'function') {
        Promise.resolve(result).catch(() => {});
        throw new TypeError(message);
    }
    return result;
}

module.exports = synchronous;
