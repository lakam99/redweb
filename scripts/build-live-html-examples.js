'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const examples = path.resolve(__dirname, '..', 'examples', 'live-html');
const configFile = ts.readConfigFile(path.join(examples, 'tsconfig.json'), ts.sys.readFile);
if (configFile.error) throw new Error(ts.formatDiagnostic(configFile.error, formatHost()));
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, examples);
const program = ts.createProgram(config.fileNames, config.options);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) throw new Error(ts.formatDiagnostics(diagnostics, formatHost()));
const outputs = new Map();
const emitted = program.emit(undefined, (fileName, content) => outputs.set(path.resolve(fileName), content));
if (emitted.emitSkipped) throw new Error(ts.formatDiagnostics(emitted.diagnostics, formatHost()));

const stale = [];
outputs.forEach((content, output) => {
    const compiled = content.replaceAll('require("redweb")', "require('../..')");
    if (process.argv.includes('--check')) {
        const current = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '';
        if (normalizeNewlines(current) !== normalizeNewlines(compiled)) stale.push(path.relative(process.cwd(), output));
    } else {
        fs.writeFileSync(output, compiled);
    }
});
if (stale.length) throw new Error(`Generated Live HTML examples are stale: ${stale.join(', ')}. Run node scripts/build-live-html-examples.js.`);

function normalizeNewlines(value) {
    return value.replaceAll('\r\n', '\n');
}

function formatHost() {
    return {
        getCanonicalFileName: fileName => fileName,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => '\n',
    };
}
