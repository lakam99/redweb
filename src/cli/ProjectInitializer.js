'use strict';

const fs = require('fs');
const path = require('path');
const { projectFiles } = require('./templates');

class ProjectInitializer {
    constructor(version) {
        this.files = projectFiles(version);
    }

    initialize(target) {
        const root = path.resolve(target);
        const created = [];
        const skipped = [];
        for (const file of this.files) {
            const destination = path.join(root, file.path);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            if (fs.existsSync(destination)) {
                skipped.push(file.path);
                continue;
            }
            fs.writeFileSync(destination, file.content, { encoding: 'utf8', flag: 'wx' });
            created.push(file.path);
        }
        return Object.freeze({ root, created: Object.freeze(created), skipped: Object.freeze(skipped) });
    }
}

module.exports = ProjectInitializer;
