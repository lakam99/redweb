/** The client owns rendering and transport; the server supplies page JSON. */
function browserRuntime(clientPath) {
    return `import { mountLivePage } from ${JSON.stringify(clientPath)};\nmountLivePage();\n`;
}

module.exports = browserRuntime;
