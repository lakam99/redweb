'use strict';

const path = require('path');
const { projectFiles } = require('./templates');
const { FilePlan } = require('./FilePlan');

class ProjectInitializer {
    constructor(version) {
        this.version = version;
    }

    initialize(target, options = {}) {
        const root = path.resolve(target);
        const templateFiles = projectFiles(this.version, options.template);
        const files = options.existing ? templateFiles.filter(file => file.path === 'tsconfig.json') : templateFiles;
        return new FilePlan(root, files).write({ dryRun: options.dryRun });
    }
}

module.exports = ProjectInitializer;
