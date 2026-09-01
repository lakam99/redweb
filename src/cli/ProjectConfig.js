'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

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

function readConfig(ts, root, filename = 'tsconfig.json', host = ts.sys) {
    const configPath = path.resolve(root, filename).replaceAll('\\', '/');
    const read = ts.readConfigFile(configPath, host.readFile);
    if (read.error) return { syntaxError: read.error };
    return { config: ts.parseJsonConfigFileContent(read.config, host, path.dirname(configPath), undefined, configPath) };
}

module.exports = { resolveDependency, readConfig };
