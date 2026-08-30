'use strict';

const fs = require('fs');
const path = require('path');
const { projectFiles } = require('./templates');

class ProjectInitializer {
    constructor(version) {
        this.version = version;
    }

    initialize(target, options = {}) {
        const root = path.resolve(target);
        const created = [];
        const skipped = [];
        const planned = [];
        const templateFiles = projectFiles(this.version, options.template);
        const files = options.existing ? templateFiles.filter(file => file.path === 'tsconfig.json') : templateFiles;
        // Preflight the complete plan before creating directories or writing files.
        for (const file of files) {
            const destination = path.join(root, file.path);
            assertSafePath(destination, root);
            const entry = fs.lstatSync(destination, { throwIfNoEntry: false });
            if (entry) {
                if (!entry.isFile()) throw new Error(`Expected a file at ${destination}; nothing was written.`);
                skipped.push(file.path);
                continue;
            }
            planned.push(file);
        }
        if (!options.dryRun) {
            for (const file of planned) {
                const destination = path.join(root, file.path);
                assertSafePath(destination, root);
                fs.mkdirSync(path.dirname(destination), { recursive: true });
                fs.writeFileSync(destination, file.content, { encoding: 'utf8', flag: 'wx' });
                created.push(file.path);
            }
        }
        return Object.freeze({
            root,
            created: Object.freeze(created),
            skipped: Object.freeze(skipped),
            planned: Object.freeze(planned.map(file => file.path)),
        });
    }
}

function assertSafePath(destination, root) {
    let current = destination;
    while (true) {
        const entry = fs.lstatSync(current, { throwIfNoEntry: false });
        if (entry?.isSymbolicLink()) throw new Error(`Refusing to initialize through a symbolic link: ${current}`);
        if (current !== destination && entry && !entry.isDirectory()) {
            throw new Error(`Expected a directory at ${current}; nothing was written.`);
        }
        if (current === root) return;
        current = path.dirname(current);
    }
}

module.exports = ProjectInitializer;
