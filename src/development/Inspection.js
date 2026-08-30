'use strict';

const LivePage = require('../htmx/LivePage');
const { list, text, members, freeze, mapSize } = require('./description');
const dataProperty = require('../dataProperty');
const { observedRenderer, rendererRoute } = require('./ObservedRenderer');
const developmentSettings = require('./settings');
const HISTORY_LIMIT = 256;

function createInspection(options) {
    return developmentSettings(options).inspect ? new Inspection() : null;
}

class Inspection {
    constructor() {
        this.events = [];
        this.sequence = 0;
        this.identifiers = new WeakMap();
        this.nextIdentifier = 0;
        this.Renderer = observedRenderer(this);
    }

    id(object) {
        let identifier = this.identifiers.get(object);
        if (!identifier) {
            identifier = ++this.nextIdentifier;
            this.identifiers.set(object, identifier);
        }
        return identifier;
    }

    record(renderer, kind, details) {
        // Inspector failures must not change application behavior or disclose errors.
        try {
            const event = freeze({ sequence: ++this.sequence, render: this.id(renderer), route: rendererRoute(renderer), kind, ...details });
            if (this.events.length === HISTORY_LIMIT) this.events.shift();
            this.events.push(event);
        } catch { /* Inspection is best effort, never an application error path. */ }
    }

    snapshot(server) {
        const manager = server.manager;
        const sockets = manager ? server.sockets : server;
        const budget = { remaining: 1000 };
        const limited = (values, describe) => list(values, describe, budget);
        const describe = read => {
            try { return { available: true, ...read() }; }
            catch { return { available: false }; }
        };
        return freeze({
            schemaVersion: 1,
            mode: 'development',
            pages: describe(() => manager ? this.pages(manager, limited) : { registrations: limited([]), sessions: limited([]) }),
            sockets: describe(() => ({ routes: limited(sockets ? dataProperty(sockets, 'routes') : [], route => {
                const rooms = dataProperty(route, 'rooms'), sessions = dataProperty(route, 'sessions');
                return {
                    path: text(dataProperty(route, 'path')), handlers: limited(dataProperty(route, 'handlers'), handler => text(dataProperty(handler, 'name'))),
                    registeredConnections: mapSize(dataProperty(route, 'clients')), draining: dataProperty(route, 'draining') === true,
                    rooms: rooms === null ? 0 : mapSize(dataProperty(rooms, 'rooms')),
                    sessions: sessions === null ? 0 : mapSize(dataProperty(sessions, 'sessions')),
                };
            }), pendingUpgrades: sockets ? mapSize(dataProperty(sockets, 'pendingUpgrades')) : 0, draining: dataProperty(sockets, 'draining') === true })),
            history: { items: [...this.events], total: this.sequence, truncated: this.sequence > this.events.length,
                limit: HISTORY_LIMIT },
        });
    }

    pages(manager, limited) {
        const sessions = new Set([...manager.pending.values(), ...manager.active.values()]);
        const connections = { connected: 0, detaching: 0, pending: 0, retained: 0 };
        const instances = new Map();
        const remember = (record, instance) => {
            if (!instances.has(record)) instances.set(record, new Set());
            instances.get(record).add(instance);
        };
        for (const session of sessions) {
            remember(session.record, session.page);
            connections[sessionStatus(manager, session)]++;
        }
        for (const record of manager.records.values()) if (record.shared) remember(record, record.shared);
        return {
            closing: manager.closing, rendering: manager.rendering, connections,
            registrations: limited(manager.records.values(), record => ({
                path: text(record.metadata.path), live: record.metadata.live !== false, shared: record.metadata.scope === 'shared',
                ...members(dataProperty(record, 'PageClass'), limited),
                instanceMetadata: instances.has(record) ? 'observed' : 'unobserved',
                instances: limited(instances.get(record) || [], instance => ({ id: this.id(instance), ...LivePage.describe(instance, limited) })),
            })),
            sessions: limited(sessions, session => ({
                render: this.id(session.renderLifetime), instance: this.id(session.page), route: text(session.record.metadata.path),
                status: sessionStatus(manager, session),
                reactive: Boolean(session.renderer),
            })),
        };
    }
}

function sessionStatus(manager, session) {
    return session.detaching ? 'detaching' : session.socket?.readyState === 1 ? 'connected' :
        manager.pending.has(session.id) ? 'pending' : 'retained';
}

module.exports = { Inspection, createInspection };
