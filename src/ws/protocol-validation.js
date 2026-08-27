function validString(value, maxLength) {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function validateEnvelope(message, version) {
    if (!message || typeof message !== 'object' || message.v !== version || !validString(message.type, 256)) return false;
    if (message.requestId !== undefined && !validString(message.requestId, 256)) return false;
    if (message.sequence !== undefined && (!Number.isSafeInteger(message.sequence) || message.sequence < 0)) return false;
    if (message.type === 'error') {
        return Boolean(
            !Object.prototype.hasOwnProperty.call(message, 'payload') &&
            message.error &&
            typeof message.error === 'object' &&
            validString(message.error.code, 256) &&
            validString(message.error.message, 1024)
        );
    }
    return Object.prototype.hasOwnProperty.call(message, 'payload') && message.error === undefined;
}

module.exports = { validateEnvelope };
