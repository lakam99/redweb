const { broadcast } = require('./util');

class RoomRegistry {
    constructor(options = {}, { hasConnection, policy, onChange } = {}) {
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
            throw new TypeError('`rooms` must be an object or true.');
        }
        const {
            maxRooms = 1000,
            maxMembersPerRoom = 1000,
            maxRoomsPerConnection = 32,
            maxRoomIdLength = 128,
        } = options;
        for (const [name, value] of Object.entries({ maxRooms, maxMembersPerRoom, maxRoomsPerConnection, maxRoomIdLength })) {
            if (!Number.isInteger(value) || value < 1) throw new TypeError(`\`rooms.${name}\` must be a positive integer.`);
        }
        if (hasConnection !== undefined && typeof hasConnection !== 'function') {
            throw new TypeError('`hasConnection` must be a function.');
        }
        if (onChange !== undefined && typeof onChange !== 'function') {
            throw new TypeError('`onChange` must be a function.');
        }
        this.options = { maxRooms, maxMembersPerRoom, maxRoomsPerConnection, maxRoomIdLength };
        this.hasConnection = hasConnection || (() => true);
        this.policy = policy;
        this.onChange = onChange || (() => {});
        this.rooms = new Map();
        this.memberships = new WeakMap();
        this.closed = false;
    }

    validateRoomId(roomId) {
        if (typeof roomId !== 'string' || !roomId || roomId.length > this.options.maxRoomIdLength) {
            throw new TypeError(`Room IDs must be non-empty strings of at most ${this.options.maxRoomIdLength} characters.`);
        }
    }

    join(roomId, socket) {
        this.validateRoomId(roomId);
        if (this.closed) return false;
        if (!socket || !this.hasConnection(socket)) return false;
        let members = this.rooms.get(roomId);
        if (members?.has(socket)) return true;
        const memberships = this.memberships.get(socket) || new Set();
        if (!members && this.rooms.size >= this.options.maxRooms) return false;
        if (members && members.size >= this.options.maxMembersPerRoom) return false;
        if (memberships.size >= this.options.maxRoomsPerConnection) return false;
        if (!members) {
            members = new Set();
            this.rooms.set(roomId, members);
        }
        members.add(socket);
        memberships.add(roomId);
        this.memberships.set(socket, memberships);
        this.onChange('join', roomId, socket);
        return true;
    }

    leave(roomId, socket) {
        this.validateRoomId(roomId);
        const members = this.rooms.get(roomId);
        if (!members?.delete(socket)) return false;
        const memberships = this.memberships.get(socket);
        memberships?.delete(roomId);
        if (!memberships?.size) this.memberships.delete(socket);
        if (!members.size) this.rooms.delete(roomId);
        this.onChange('leave', roomId, socket);
        return true;
    }

    leaveAll(socket) {
        const memberships = this.memberships.get(socket);
        if (!memberships) return 0;
        const roomIds = [...memberships];
        roomIds.forEach(roomId => this.leave(roomId, socket));
        return roomIds.length;
    }

    members(roomId) {
        this.validateRoomId(roomId);
        return [...(this.rooms.get(roomId) || [])];
    }

    has(roomId, socket) {
        this.validateRoomId(roomId);
        return Boolean(this.rooms.get(roomId)?.has(socket));
    }

    broadcast(roomId, data, { except } = {}) {
        this.validateRoomId(roomId);
        if (this.closed) return 0;
        const members = this.rooms.get(roomId);
        if (!members) return 0;
        const recipients = except === undefined
            ? members
            : [...members].filter(socket => socket !== except);
        return broadcast(recipients, data, this.policy);
    }

    clear() {
        this.rooms.clear();
        this.memberships = new WeakMap();
    }

    close() {
        if (this.closed) return false;
        this.closed = true;
        this.clear();
        return true;
    }

    get size() {
        return this.rooms.size;
    }
}

module.exports = RoomRegistry;
