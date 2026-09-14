'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const sources = new Set(['node:net', 'node:events', 'node:buffer', 'node:timers',
    'node:_http_client', 'node:_http_common', 'node:_http_agent', 'node:_http_outgoing',
    'node:internal/streams/readable', 'node:internal/streams/writable', 'node:internal/streams/destroy',
    'node:internal/streams/utils', 'node:internal/stream_base_commons', 'node:internal/async_hooks',
    'node:internal/timers', 'node:internal/buffer', 'node:internal/validators', 'node:internal/errors',
    'node:internal/util', 'node:internal/child_process', 'node:internal/bootstrap/switches/is_main_thread',
    'node:_tls_wrap', 'node:internal/js_stream_socket',
    'node_modules/ws/lib/websocket.js', 'node_modules/ws/lib/receiver.js', 'node_modules/ws/lib/sender.js',
    'node_modules/ws/lib/buffer-util.js', 'node_modules/ws/lib/validation.js', 'node_modules/ws/lib/permessage-deflate.js',
    'scripts/realtime-harness.js', 'scripts/diagnostics/recovery-split-worker.cjs',
    'scripts/diagnostics/ClientHeapCapture.cjs']);
const names = new Set(['initAsClient', 'dispatch', 'waitFor', 'closeClient', 'onSocketNT', 'emit',
    'read', 'write', 'onwrite', 'getDefaultTriggerAsyncId', 'validateNumber', 'validateString',
    'receiverOnMessage', 'socketOnData', 'socketOnClose', 'getDefaultHighWaterMark', 'clearBuffer',
    'addChunk', 'readableAddChunk', 'writeOrBuffer', 'Readable', 'Writable', 'Socket',
    'Sender', 'Receiver', 'WebSocket', 'onceWrapper', 'getStderr', 'TLSSocket', 'JSStreamSocket']);
const strong = edge => edge.kind !== 'weak' && edge.kind !== 'shortcut';

// Association, never exclusive ownership. No numerical hidden-slot assumptions:
// snapshot hidden indices are compact visitor indices, not object field offsets.
class CodeAttribution {
    constructor(graph, root = path.resolve(__dirname, '../..'), maxAssociations = 2000000) {
        assert(Number.isSafeInteger(maxAssociations) && maxAssociations > 0 && maxAssociations <= 2000000);
        this.graph = graph;
        this.work = 0;
        this.maxAssociations = maxAssociations;
        this.sfiTargets = new Map();
        this.links = graph.nodes.map(node => {
            const links = new Map();
            for (const edge of node.out) if (['internal', 'property', 'context'].includes(edge.kind)) {
                const key = `${edge.kind}:${edge.name}`;
                links.set(key, links.has(key) ? undefined : edge.target);
            }
            return links;
        });
        this.root = `${path.resolve(root).replaceAll('\\', '/')}/`;
        this.functions = new Map();
        this.roles = Object.fromEntries(['code', 'instructionStream', 'deoptData', 'relocationInfo', 'sourcePositionTable', 'feedbackVector'].map(role => [role, new Set()]));
        this.statuses = { associated: 0, missingSfi: 0, ambiguousSfi: 0, conflictingClosure: 0, unsupportedStructure: 0 };
        this.feedbackStatuses = { associated: 0, unresolved: 0, conflictingClosure: 0 };
        this.feedbackAssociations = new Map();
        this.associations = new Map();
        this.codeClosures = new Map();
        this.byId = new Map(graph.nodes.map(node => [node.id, node]));
        const nodes = graph.nodes;
        for (const [index, node] of nodes.entries()) {
            if (node.type === 'code' && this.one(index, 'script') !== undefined
                && nodes[this.one(index, 'script')].type === 'code'
                && this.one(index, 'name_or_scope_info') !== undefined && this.one(index, 'function_data') !== undefined) {
                this.functions.set(index, { closures: new Set(), codes: new Set(), current: new Set(), feedback: new Set(), metadata: new Set() });
            }
        }
        const currentOwners = new Map(), feedbackOwners = new Map();
        for (const [index, node] of nodes.entries()) {
            if (node.type !== 'closure') continue;
            const shared = this.one(index, 'shared'), record = this.functions.get(shared);
            if (!record) continue;
            record.closures.add(index);
            const code = this.one(index, 'code');
            if (code !== undefined) {
                if (!currentOwners.has(code)) currentOwners.set(code, new Set());
                currentOwners.get(code).add(shared);
                if (!this.codeClosures.has(code)) this.codeClosures.set(code, new Set());
                this.codeClosures.get(code).add(index);
            }
            const cell = this.one(index, 'feedback_cell');
            const vector = cell === undefined ? undefined : this.one(cell, 'value');
            if (vector !== undefined && nodes[vector].type === 'code' && nodes[vector].name === 'system / FeedbackVector') {
                if (!feedbackOwners.has(vector)) feedbackOwners.set(vector, new Set());
                feedbackOwners.get(vector).add(shared);
            }
        }
        for (const [index, node] of nodes.entries()) {
            if (node.type !== 'code' || node.name !== 'system / FeedbackVector') continue;
            this.roles.feedbackVector.add(index);
            const candidates = this.directSfis(index);
            if (candidates.size !== 1) { this.feedbackStatuses.unresolved++; continue; }
            const shared = [...candidates][0];
            if ([...(feedbackOwners.get(index) ?? [])].some(owner => owner !== shared)) {
                this.feedbackStatuses.conflictingClosure++; continue;
            }
            this.functions.get(shared).feedback.add(index);
            this.feedbackAssociations.set(index, shared);
            this.feedbackStatuses.associated++;
        }
        const metadataCache = new Map();
        for (const [index, node] of nodes.entries()) {
            if (node.type !== 'code' || !node.out.some(edge => edge.kind === 'internal' && edge.name === 'deoptimization_data')) continue;
            this.roles.code.add(index);
            const data = this.one(index, 'deoptimization_data'), stream = this.one(index, 'instruction_stream');
            if (data === undefined || stream === undefined || nodes[data].type !== 'code'
                || nodes[stream].type !== 'code' || this.one(stream, 'code') !== index) {
                this.statuses.unsupportedStructure++; continue;
            }
            this.roles.instructionStream.add(stream);
            for (const [role, source, name] of [['relocationInfo', stream, 'relocation_info'], ['sourcePositionTable', index, 'source_position_table']]) {
                const target = this.one(source, name);
                if (target !== undefined && nodes[target].type === 'code') this.roles[role].add(target);
            }
            if (!metadataCache.has(data)) metadataCache.set(data, new Set([data, ...nodes[data].out.filter(edge => strong(edge)
                && nodes[edge.target].type === 'code' && !this.functions.has(edge.target)).map(edge => edge.target)]));
            const metadata = metadataCache.get(data);
            // Only the outer data and direct code-typed, non-SFI children.
            // Never traverse literal-array/inlined SFIs as alternate owners.
            this.work += metadata.size * 2;
            assert(this.work <= this.maxAssociations, 'Attribution association limit exceeded');
            for (const target of metadata) this.roles.deoptData.add(target);
            const candidates = this.directSfis(data);
            if (candidates.size !== 1) {
                this.statuses[candidates.size === 0 ? 'missingSfi' : 'ambiguousSfi']++; continue;
            }
            const shared = [...candidates][0];
            const owners = currentOwners.get(index) ?? new Set();
            if ([...owners].some(owner => owner !== shared)) { this.statuses.conflictingClosure++; continue; }
            this.statuses.associated++;
            this.associations.set(index, shared);
            const record = this.functions.get(shared);
            record.codes.add(index);
            if (owners.has(shared)) record.current.add(index);
            for (const target of metadata) record.metadata.add(target);
        }
    }

    one(index, name, kind = 'internal') {
        return this.links[index]?.get(`${kind}:${name}`);
    }

    directSfis(index) {
        if (!this.sfiTargets.has(index)) this.sfiTargets.set(index, new Set(this.graph.nodes[index].out
            .filter(edge => ['internal', 'hidden'].includes(edge.kind) && this.functions.has(edge.target)).map(edge => edge.target)));
        return this.sfiTargets.get(index);
    }

    label(index) {
        const node = this.graph.nodes[index];
        const script = this.one(index, 'script'), filename = this.one(script, 'name');
        let source = filename === undefined || this.graph.nodes[filename].type !== 'string'
            ? '' : this.graph.nodes[filename].name.replaceAll('\\', '/');
        if (source.startsWith(this.root)) source = source.slice(this.root.length);
        const known = sources.has(source);
        const sourceGroup = /^node:[\w/.-]+$/.test(source) ? 'node-builtin'
            : known && source.startsWith('node_modules/ws/') ? 'ws'
                : source === 'scripts/realtime-harness.js' ? 'realtime-harness'
                    : source === 'scripts/diagnostics/ClientHeapCapture.cjs' ? 'capture-observer' : 'other';
        return { sourceGroup, source: known ? source : 'unclassified', name: known && names.has(node.name) ? node.name : 'unclassified' };
    }

    inventory() {
        const functions = new Map();
        const histogram = {};
        let currentCodes = 0, associatedFunctions = 0;
        for (const [index, record] of this.functions) {
            const size = indices => [...indices].reduce((sum, target) => sum + this.graph.nodes[target].size, 0);
            const data = this.one(index, 'function_data');
            const baseline = this.one(data, 'interpreter_data') === undefined ? [] : [this.graph.nodes[data].id];
            functions.set(this.graph.nodes[index].id, { ...this.label(index), closures: record.closures.size,
                codes: record.codes.size, currentCodes: record.current.size, feedbackVectors: record.feedback.size,
                baselineCodes: baseline.length, baselineIds: baseline,
                codeAndStreamSelfBytes: size(record.codes) + size(new Set([...record.codes].map(code => this.one(code, 'instruction_stream')))),
                deoptDataSelfBytes: size(record.metadata), codeIds: new Set([...record.codes].map(code => this.graph.nodes[code].id)) });
            if (record.codes.size > 0) {
                histogram[record.codes.size] = (histogram[record.codes.size] ?? 0) + 1;
                associatedFunctions++;
            }
            currentCodes += record.current.size;
        }
        return { functions, histogram, currentCodes, associatedFunctions };
    }

    socketInventory() {
        const nodes = this.graph.nodes, stderrContexts = new Set(), prototypes = new Map();
        for (const [index, node] of nodes.entries()) {
            if (node.type !== 'closure') continue;
            const shared = this.one(index, 'shared');
            if (!this.functions.has(shared)) continue;
            const { source, name } = this.label(shared);
            const context = this.one(index, 'context');
            if (source === 'node:internal/bootstrap/switches/is_main_thread' && name === 'getStderr'
                && context !== undefined && nodes[context].type === 'object' && nodes[context].name === 'system / Context') stderrContexts.add(context);
            if (source === 'node:_tls_wrap' && name === 'TLSSocket') prototypes.set(index, 'tls-prototype');
            if (source === 'node:internal/js_stream_socket' && name === 'JSStreamSocket') prototypes.set(index, 'js-stream-prototype');
        }
        const result = new Map();
        for (const [index, node] of nodes.entries()) {
            if (node.type !== 'object' || node.name !== 'Socket') continue;
            const labels = new Set();
            for (const edge of node.incoming) {
                if (edge.kind === 'property' && edge.name === 'prototype' && prototypes.has(edge.source)) labels.add(prototypes.get(edge.source));
                if (edge.kind === 'context' && edge.name === 'stderr' && stderrContexts.has(edge.source)) labels.add('stderr-cache');
            }
            result.set(node.id, { kind: labels.size === 0 ? 'unclassified' : labels.size === 1 ? [...labels][0] : 'ambiguous', selfBytes: node.size });
        }
        return result;
    }

    workerPath() {
        const nodes = this.graph.nodes, paths = [], websockets = new Set();
        const sourced = (index, source, name) => {
            if (index === undefined || nodes[index].type !== 'closure') return false;
            const shared = this.one(index, 'shared');
            if (!this.functions.has(shared)) return false;
            const label = this.label(shared);
            return label.source === source && (name === undefined || label.name === name);
        };
        let helpers = [];
        for (const [index, node] of nodes.entries()) {
            if (node.type !== 'object' || node.name !== 'process' || !this.graph.parents.has(index)) continue;
            const events = this.one(index, '_events', 'property'), listener = this.one(events, 'message', 'property');
            const context = this.one(listener, 'context'), socket = this.one(context, 'WebSocket', 'context');
            const socketContext = this.one(socket, 'context'), outer = this.one(socketContext, 'previous');
            const init = this.one(outer, 'initAsClient', 'context');
            if (!sourced(listener, 'scripts/diagnostics/recovery-split-worker.cjs')
                || !sourced(socket, 'node_modules/ws/lib/websocket.js', 'WebSocket')
                || !sourced(init, 'node_modules/ws/lib/websocket.js', 'initAsClient')
                || nodes[events].type !== 'object'
                || [context, socketContext, outer].some(target => nodes[target].type !== 'object' || nodes[target].name !== 'system / Context')) continue;
            paths.push([index, events, listener, context, socket, socketContext, outer, init].map(target => nodes[target].id));
            websockets.add(socket);
            helpers = ['closeClient', 'waitFor'].filter(name => sourced(this.one(context, name, 'context'), 'scripts/realtime-harness.js', name));
        }
        let moduleExports = 0;
        for (const [index, node] of nodes.entries()) {
            if (node.type !== 'object' || node.name !== 'Module' || !this.graph.parents.has(index)
                || !websockets.has(this.one(index, 'exports', 'property'))) continue;
            const filename = this.one(index, 'filename', 'property');
            if (filename === undefined || nodes[filename].type !== 'string') continue;
            const raw = nodes[filename].name.replaceAll('\\', '/');
            const relative = raw.startsWith(this.root) ? raw.slice(this.root.length) : raw;
            if (['node_modules/ws/lib/websocket.js', 'node_modules/ws/index.js'].includes(relative)) moduleExports++;
        }
        return { paths, summary: { matchedPaths: paths.length, uniquePath: paths.length === 1,
            helperBindings: paths.length === 1 ? helpers : [], rootedModuleExports: moduleExports } };
    }

    compare(previous, maximum = 128) {
        assert(Number.isSafeInteger(maximum) && maximum > 0 && maximum <= 128);
        const before = previous.inventory(), after = this.inventory();
        const rows = [], multiple = { groups: 0, unchangedCodeSets: 0, allCurrentInClosures: 0 };
        const display = value => {
            if (!value) return null;
            const { codeIds, baselineIds, ...publicValues } = value;
            return publicValues;
        };
        for (const id of new Set([...before.functions.keys(), ...after.functions.keys()])) {
            const prior = before.functions.get(id), current = after.functions.get(id);
            if ((prior?.codes ?? 0) === 0 && (current?.codes ?? 0) === 0) continue;
            if (current && current.codes > 1) {
                multiple.groups++;
                if (prior && prior.codeIds.size === current.codeIds.size && [...current.codeIds].every(code => prior.codeIds.has(code))) multiple.unchangedCodeSets++;
                if (current.currentCodes === current.codes) multiple.allCurrentInClosures++;
            }
            rows.push({ sameFunctionIdentity: Boolean(prior && current),
                sameBaselineCode: Boolean(prior && current && prior.baselineIds.length === 1 && prior.baselineIds[0] === current.baselineIds[0]),
                before: display(prior), after: display(current) });
        }
        rows.sort((a, b) => (b.after?.codeAndStreamSelfBytes ?? 0) - (a.after?.codeAndStreamSelfBytes ?? 0));
        const roles = Object.keys(this.roles).map(role => {
            const priorIds = new Set([...previous.roles[role]].map(index => previous.graph.nodes[index].id));
            const ids = new Set([...this.roles[role]].map(index => this.graph.nodes[index].id));
            const bytes = (set, nodes) => [...set].reduce((sum, id) => sum + nodes.get(id).size, 0);
            return { role, beforeCount: priorIds.size, afterCount: ids.size,
                beforeSelfBytes: bytes(priorIds, previous.byId), afterSelfBytes: bytes(ids, this.byId),
                addedCount: [...ids].filter(id => !priorIds.has(id)).length,
                removedCount: [...priorIds].filter(id => !ids.has(id)).length };
        });
        let preexistingFunctionCodes = 0, preexistingClosureCodes = 0;
        for (const [code, shared] of this.associations) {
            const id = this.graph.nodes[shared].id;
            if (before.functions.has(id)) preexistingFunctionCodes++;
            if ([...(this.codeClosures.get(code) ?? [])].some(index => {
                const prior = previous.byId.get(this.graph.nodes[index].id);
                return prior?.type === 'closure' && prior.out.some(edge => edge.kind === 'internal' && edge.name === 'shared'
                    && previous.graph.nodes[edge.target].id === id);
            })) preexistingClosureCodes++;
        }
        const addedBySource = (indices, associations, includeStream) => {
            const groups = new Map();
            for (const index of indices) {
                if (previous.byId.has(this.graph.nodes[index].id)) continue;
                const shared = associations.get(index);
                const group = shared === undefined ? 'unresolved' : this.label(shared).sourceGroup;
                if (!groups.has(group)) groups.set(group, { sourceGroup: group, count: 0, selfBytes: 0 });
                const row = groups.get(group);
                row.count++; row.selfBytes += this.graph.nodes[index].size;
                const stream = this.one(index, 'instruction_stream');
                if (includeStream && stream !== undefined && this.roles.instructionStream.has(stream)
                    && this.one(stream, 'code') === index) row.selfBytes += this.graph.nodes[stream].size;
            }
            return [...groups.values()].sort((a, b) => a.sourceGroup.localeCompare(b.sourceGroup));
        };
        const metadataTotal = inventory => {
            const indices = new Set(Object.entries(inventory.roles).filter(([role]) => role !== 'feedbackVector').flatMap(([, values]) => [...values]));
            return { count: indices.size, selfBytes: [...indices].reduce((sum, index) => sum + inventory.graph.nodes[index].size, 0) };
        };
        const previousSockets = previous.socketInventory(), sockets = this.socketInventory();
        const priorWorker = previous.workerPath(), worker = this.workerPath();
        const socketRoles = ['stderr-cache', 'tls-prototype', 'js-stream-prototype', 'unclassified', 'ambiguous'].map(kind => {
            const matching = inventory => [...inventory].filter(([, value]) => value.kind === kind);
            const prior = matching(previousSockets), current = matching(sockets);
            return { kind, beforeCount: prior.length, afterCount: current.length,
                afterSelfBytes: current.reduce((sum, [, value]) => sum + value.selfBytes, 0),
                sameIdentityAndRoleCount: current.filter(([id]) => previousSockets.get(id)?.kind === kind).length };
        });
        return { diagnosticOnly: true, exclusiveOwnershipProven: false, invalidationStatusKnown: false,
            currentMeansClosureCodeField: true, perFunctionBytesMayOverlap: true,
            before: { statuses: previous.statuses, feedbackStatuses: previous.feedbackStatuses, associatedFunctions: before.associatedFunctions, histogram: before.histogram, currentCodes: before.currentCodes },
            after: { statuses: this.statuses, feedbackStatuses: this.feedbackStatuses, associatedFunctions: after.associatedFunctions, histogram: after.histogram, currentCodes: after.currentCodes },
            preexistingFunctionCodes, preexistingClosureCodes,
            addedCodeAndStreamBySource: addedBySource(this.roles.code, this.associations, true),
            addedFeedbackBySource: addedBySource(this.roles.feedbackVector, this.feedbackAssociations, false),
            distinctCodeAndImmediateMetadata: { before: metadataTotal(previous), after: metadataTotal(this) },
            socketRoles,
            persistentWorkerPath: { before: priorWorker.summary, after: worker.summary,
                sameEightNodes: priorWorker.paths.length === 1 && worker.paths.length === 1
                    && priorWorker.paths[0].every((id, index) => worker.paths[0][index] === id) },
            multipleVersionGroupsAfter: multiple, roles, functionGroups: rows.length,
            omittedFunctionGroups: Math.max(0, rows.length - maximum), functions: rows.slice(0, maximum) };
    }
}

module.exports = { CodeAttribution };
