const fs = require('fs');
const path = require('path');

function outside(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

class PageAssetLoader {
    constructor() {
        this.cache = new Map();
    }

    load(filePath, rootDir, kind) {
        const root = path.resolve(rootDir);
        const resolved = path.resolve(root, filePath);
        if (outside(root, resolved)) throw new Error(`Page ${kind} is outside the configured template root.`);
        if (!fs.existsSync(resolved)) throw new Error(`Page ${kind} not found: ${resolved}`);
        const canonicalRoot = fs.realpathSync(root);
        const canonicalFile = fs.realpathSync(resolved);
        if (outside(canonicalRoot, canonicalFile)) {
            throw new Error(`Page ${kind} is outside the configured template root.`);
        }
        if (!this.cache.has(canonicalFile)) {
            this.cache.set(canonicalFile, Object.freeze({
                path: canonicalFile,
                content: fs.readFileSync(canonicalFile, 'utf8'),
            }));
        }
        return this.cache.get(canonicalFile);
    }
}

module.exports = PageAssetLoader;
