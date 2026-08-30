'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const { createRequire } = require('module');

function issue(code, file, message, suggestion, severity = 'error') {
    return { code, severity, file, message, suggestion };
}

function nodeIssue(version) {
    if (Number(version.split('.')[0]) >= 18) return null;
    return issue('NODE_UNSUPPORTED', null, `Node ${version} is outside Redweb's supported range.`, 'Use a supported Node.js release (18 or newer).');
}

function resolveDependency(root, name) {
    const requireFromProject = createRequire(path.join(root, 'package.json'));
    let current = root;
    while (true) {
        const candidate = path.join(current, 'node_modules', name);
        if (fs.existsSync(candidate)) return requireFromProject.resolve(candidate);
        const parent = path.dirname(current);
        if (parent === current) return null;
        current = parent;
    }
}

function inspectTypeScript(root, issues) {
    // TypeScript's diagnostic attachment expects normalized separators on Windows.
    const configPath = path.join(root, 'tsconfig.json').replaceAll('\\', '/');
    const typescriptPath = resolveDependency(root, 'typescript');
    if (!typescriptPath) issues.push(issue('TYPESCRIPT_MISSING', 'package.json', 'TypeScript is not installed for this project.', 'Run npm install --save-dev typescript.'));
    if (!fs.existsSync(configPath)) {
        issues.push(issue('CONFIG_MISSING', 'tsconfig.json', 'No editor-discoverable TypeScript configuration was found.', 'Run redweb init --existing, then inspect the generated configuration.'));
        return;
    }
    if (!typescriptPath) return;
    const ts = require(typescriptPath);
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error) {
        issues.push(issue('CONFIG_INVALID', 'tsconfig.json', ts.flattenDiagnosticMessageText(read.error.messageText, '\n'), 'Correct the configuration syntax and run doctor again.'));
        return;
    }
    const config = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
    if (config.errors.length) {
        for (const error of config.errors) issues.push(issue('CONFIG_INVALID', 'tsconfig.json', ts.flattenDiagnosticMessageText(error.messageText, '\n'), 'Resolve the TypeScript configuration diagnostic, including missing extends targets or source files.'));
        return;
    }
    if (config.options.jsxImportSource !== 'redweb' || ![ts.JsxEmit.ReactJSX, ts.JsxEmit.ReactJSXDev].includes(config.options.jsx)) {
        issues.push(issue('JSX_RUNTIME_MISMATCH', 'tsconfig.json', 'The effective JSX configuration does not use Redweb.', 'Extend redweb/tsconfig.json, or set jsx to react-jsx and jsxImportSource to redweb.'));
    }
    if (config.options.experimentalDecorators) {
        issues.push(issue('LEGACY_DECORATORS', 'tsconfig.json', 'Legacy decorators are enabled; the starter examples use standard decorators.', 'Set experimentalDecorators to false for standard decorator examples.', 'warning'));
    }
}

function inspectPort(port) {
    return new Promise(resolve => {
        const server = net.createServer();
        server.once('error', error => resolve(issue('PORT_UNAVAILABLE', null, `Cannot bind 127.0.0.1:${port} (${error.code}).`, 'Choose another port or stop the process that owns it.')));
        server.listen(port, '127.0.0.1', () => server.close(() => resolve(null)));
    });
}

class ProjectDoctor {
    constructor(cliVersion) {
        this.cliVersion = cliVersion;
    }

    async inspect(target, port = null) {
        const root = path.resolve(target);
        const issues = [nodeIssue(process.versions.node)].filter(Boolean);
        const manifestPath = resolveDependency(root, 'redweb/package.json');
        let installedVersion = null;
        if (!manifestPath) {
            issues.push(issue('REDWEB_MISSING', 'package.json', 'Redweb is not installed for this project.', 'Run npm install redweb.'));
        } else {
            installedVersion = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version;
            if (installedVersion !== this.cliVersion) {
                issues.push(issue('CLI_VERSION_MISMATCH', 'package.json', `CLI ${this.cliVersion} is inspecting Redweb ${installedVersion}.`, 'Use the locally installed CLI with npx --no-install redweb doctor.', 'warning'));
            }
        }
        inspectTypeScript(root, issues);
        if (port !== null) {
            const unavailable = await inspectPort(port);
            if (unavailable) issues.push(unavailable);
        }
        return {
            schemaVersion: 1,
            operation: 'doctor',
            root,
            installedVersion,
            checks: ['node', 'redweb-version', 'typescript-config', ...(port === null ? [] : ['loopback-port'])],
            ok: !issues.some(value => value.severity === 'error'),
            issues,
        };
    }
}

module.exports = { ProjectDoctor, nodeIssue };
