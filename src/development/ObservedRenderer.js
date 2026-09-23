'use strict';

const { performance } = require('perf_hooks');
const ReactiveRenderer = require('../htmx/ReactiveRenderer');
const { getPageMetadata } = require('../htmx/metadata');
const { list, text } = require('./description');
const dataProperty = require('../dataProperty');

// A separate implementation is selected once for inspected servers. No observer
// checks, callbacks or extra data structures enter the ordinary update path.
function observedRenderer(inspection) {
    return class ObservedRenderer extends ReactiveRenderer {
        invalidate(owner, name, payload) {
            if (!this.disposed) inspection.record(this, 'state-invalidated', {
                state: text(name), component: text(payload.component || 'root'),
                affectedOwners: list([...this.nodes.values()].filter(node => node.dependencies.get(owner)?.has(name)), node => text(node.id)),
            });
            return super.invalidate(owner, name, payload);
        }

        async performFlush() {
            const started = performance.now();
            const generation = this.generation;
            inspection.record(this, 'flush-started', { snapshot: this.snapshot === true, dirtyOwners: list(this.dirty) });
            try {
                await super.performFlush();
                inspection.record(this, this.disposed || generation !== this.generation ? 'flush-superseded' : 'flush-completed', {
                    durationMs: performance.now() - started,
                });
            } catch (error) {
                inspection.record(this, 'flush-failed', { durationMs: performance.now() - started });
                throw error;
            }
        }
    };
}

function rendererRoute(renderer) {
    return text(getPageMetadata(dataProperty(dataProperty(renderer, 'page'), 'constructor'))?.path);
}

module.exports = { observedRenderer, rendererRoute };
