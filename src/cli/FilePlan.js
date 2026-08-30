'use strict';

const fs = require('fs');
const path = require('path');

/** Shared, exclusive-create writer. A plan is preflighted fully, never silently overwritten. */
class FilePlan {
    constructor(root, files) {
        this.root = path.resolve(root);
        this.files = files;
    }

    write({ dryRun = false, existing = 'skip' } = {}) {
        if (!['skip', 'reject'].includes(existing)) throw new Error('Unknown existing-file policy.');
        const created = [], skipped = [], planned = [], destinations = new Map();
        for (const file of this.files) {
            const destination = path.resolve(this.root, file.path);
            assertSafePath(destination, this.root);
            registerDestination(destinations, this.root, destination);
            const entry = fs.lstatSync(destination, { throwIfNoEntry: false });
            if (entry) {
                if (!entry.isFile()) throw new Error(`Expected a file at ${destination}; nothing was written.`);
                if (existing === 'reject') throw new Error(`Refusing to overwrite ${destination}; nothing was written.`);
                skipped.push(file.path);
            } else planned.push(file);
        }
        if (!dryRun) {
            let attempted;
            try {
                for (const file of planned) {
                    attempted = file.path;
                    const destination = path.resolve(this.root, file.path);
                    assertSafePath(destination, this.root);
                    fs.mkdirSync(path.dirname(destination), { recursive: true });
                    fs.writeFileSync(destination, file.content, { encoding: 'utf8', flag: 'wx' });
                    created.push(file.path);
                }
            } catch (error) {
                throw new Error(`${error.message} Completed before failure: ${created.length ? created.join(', ') : 'none'}. Attempted: ${attempted}; that file or its directories may exist.`, { cause: error });
            }
        }
        return Object.freeze({ root: this.root, created: Object.freeze(created), skipped: Object.freeze(skipped),
            planned: Object.freeze(planned.map(file => file.path)) });
    }
}

function registerDestination(nodes, root, destination) {
    const parts = path.relative(root, destination).split(path.sep);
    let current = root;
    for (let index = 0; index < parts.length; index++) {
        current = path.join(current, parts[index]);
        const kind = index === parts.length - 1 ? 'file' : 'directory';
        const key = current.toLowerCase(), previous = nodes.get(key);
        if (previous && (previous.path !== current || previous.kind !== kind || kind === 'file')) {
            throw new Error(`Conflicting planned destination: ${current}`);
        }
        nodes.set(key, { path: current, kind });
    }
}

function assertSafePath(destination, root) {
    const relative = path.relative(root, destination);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Destination must be a file inside the project: ${destination}`);
    }
    for (const part of destination.slice(path.parse(destination).root.length).split(path.sep)) {
        if (/[<>:"\\|?*\u0000-\u001f]/.test(part) || /[. ]$/.test(part) || part.length > 255 ||
            /^(con|conin\$|conout\$|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part.normalize('NFKC'))) {
            throw new Error(`Nonportable destination segment: ${part}`);
        }
    }
    for (let current = destination; ; current = path.dirname(current)) {
        const entry = fs.lstatSync(current, { throwIfNoEntry: false });
        if (entry?.isSymbolicLink()) throw new Error(`Refusing to initialize through a symbolic link: ${current}`);
        if (current !== destination && entry && !entry.isDirectory()) throw new Error(`Expected a directory at ${current}; nothing was written.`);
        const parent = path.dirname(current);
        if (parent === current) return;
        // Portable plans must not create case aliases even on a case-sensitive host.
        if ((current === root || current.startsWith(`${root}${path.sep}`)) && fs.lstatSync(parent, { throwIfNoEntry: false })?.isDirectory()) {
            const name = path.basename(current);
            const alias = fs.readdirSync(parent).find(value => value.toLowerCase() === name.toLowerCase() && value !== name);
            if (alias) throw new Error(`Case-colliding destination: ${current} conflicts with ${alias}`);
        }
    }
}

module.exports = { FilePlan, assertSafePath };
