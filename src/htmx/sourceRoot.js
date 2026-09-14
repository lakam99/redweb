const path = require('path');
const { fileURLToPath } = require('url');

function filePath(fileName) {
    return fileName.startsWith('file:') ? fileURLToPath(fileName) : fileName;
}

function callerDirectory(frames, internalDirectory) {
    const caller = frames.find(frame => {
        const fileName = frame.getFileName?.();
        return fileName && path.dirname(filePath(fileName)) !== internalDirectory;
    });
    return caller ? path.dirname(filePath(caller.getFileName())) : process.cwd();
}

function decoratorDirectory() {
    const prepareStackTrace = Error.prepareStackTrace;
    try {
        Error.prepareStackTrace = (_error, frames) => frames;
        const error = new Error();
        Error.captureStackTrace(error, decoratorDirectory);
        return callerDirectory(error.stack, __dirname);
    } finally {
        Error.prepareStackTrace = prepareStackTrace;
    }
}

module.exports = { callerDirectory, decoratorDirectory, filePath };
