// handlers/SocketRegistry.js
const { EventEmitter } = require("events");

class SocketRegistry extends EventEmitter {
    constructor() {
        super();
        this.items = [];
    }

    add(item) {
        this.items.push(item);
        this.emit("added", item);
    }

    remove(itemOrId, by = "id") {
        const idx = typeof itemOrId === "object"
            ? this.items.findIndex(i => i === itemOrId)
            : this.items.findIndex(i => i[by] === itemOrId);

        if (idx !== -1) {
            const [removed] = this.items.splice(idx, 1);
            this.emit("removed", removed);
            return true;
        }
        return false;
    }

    all() {
        return [...this.items];
    }

    count() {
        return this.all().length;
    }
}

module.exports = SocketRegistry;
