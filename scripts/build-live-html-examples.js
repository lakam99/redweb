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
const emitted = program.emit();
if (emitted.emitSkipped) throw new Error(ts.formatDiagnostics(emitted.diagnostics, formatHost()));

fs.readdirSync(examples)
    .filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts'))
    .forEach(file => {
        const output = path.join(examples, file.replace(/\.ts$/, '.js'));
        const compiled = fs.readFileSync(output, 'utf8');
        fs.writeFileSync(output, compiled.replaceAll('require("redweb")', "require('../..')"));
    });

function formatHost() {
    return {
        getCanonicalFileName: fileName => fileName,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => '\n',
    };
}
