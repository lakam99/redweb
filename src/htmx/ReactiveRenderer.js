'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const capture = new AsyncLocalStorage();
const ROOT = 'root';
const MAX_OWNERS = 1024;
const MAX_HTML_BYTES = 1024 * 1024;

function ownerId(component) {
    return component ? `c${Buffer.from(component).toString('hex')}` : ROOT;
}

function boundary(id, html) { return `<!--rw:${id}-->${html}<!--/rw:${id}-->`; }

function replaceBoundary(source, id, html) {
    const start = `<!--rw:${id}-->`;
    const end = `<!--/rw:${id}-->`;
    return source.split(start).map((part, index) => index ? html + part.slice(part.indexOf(end)) : part).join(start);
}

/** One rendering history per HTTP/page session, including shared pages. Never shares request context. */
class ReactiveRenderer {
    constructor(page, signal, timeoutMs = 5000) {
        this.page = page;
        this.nodes = new Map();
        this.dirty = new Set();
        this.states = new Map();
        this.socket = null;
        this.pending = null;
        this.running = null;
        this.generation = 0;
        this.disposed = false;
        this.enabled = false;
        this.controller = new AbortController();
        this.connection = new AbortController();
        this.timeoutMs = timeoutMs;
        this.parentSignal = signal;
        this.abort = () => this.dispose();
        signal.addEventListener('abort', this.abort, { once: true });
        if (signal.aborted) this.dispose();
    }

    static read(owner, name) {
        const current = capture.getStore();
        if (!current) return;
        const names = current.node.dependencies.get(owner) || new Set();
        names.add(name);
        current.node.dependencies.set(owner, names);
    }

    static assertWritable() {
        if (capture.getStore()) throw new Error('State cannot be modified during render().');
    }

    static jsx() {
        const current = capture.getStore();
        if (current) current.node.jsx = true;
        return Boolean(current);
    }

    static key(html, value) {
        if (!capture.getStore() || value === undefined || value === null) return html;
        if (!['string', 'number'].includes(typeof value)) throw new TypeError('JSX keys must be strings or numbers.');
        const key = String(value);
        if (key.length > 256) throw new TypeError('JSX keys must be at most 256 characters.');
        return boundary(`k${Buffer.from(key).toString('hex')}`, html);
    }

    static component(owner, component, render) {
        const current = capture.getStore();
        if (!current) return render();
        const id = ownerId(component);
        current.node.children.add(id);
        const cached = current.stage.get(id);
        if (cached) return boundary(id, cached.html);
        const node = current.renderer.node(owner, id, render);
        const html = capture.run({ ...current, node }, render);
        current.renderer.finish(node, html, current.stage);
        return boundary(id, html);
    }

    node(owner, id, render) {
        return { owner, id, render, html: '', dependencies: new Map(), children: new Set(), jsx: false };
    }

    finish(node, html, stage) {
        const retainedBytes = [...stage.values()].reduce((total, entry) => total + Buffer.byteLength(entry.html), 0);
        if (retainedBytes + Buffer.byteLength(html) > MAX_HTML_BYTES) throw new Error('Reactive HTML exceeds the 1 MiB snapshot limit.');
        if (stage.size >= MAX_OWNERS) throw new Error('Reactive render exceeds the 1024 owner limit.');
        node.html = html;
        stage.set(node.id, node);
    }

    async renderNode(previous, signal = this.controller.signal) {
        const stage = new Map();
        const node = this.node(previous.owner, previous.id, previous.render);
        const work = Promise.resolve().then(() => this.withContext(() => capture.run({ renderer: this, node, stage }, node.render)));
        let timer;
        let abort;
        const cancelled = new Promise((_, reject) => {
            abort = () => reject(new Error('Reactive render was cancelled: page disconnected or server shutting down.'));
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
            timer = setTimeout(() => reject(new Error('Reactive render exceeded its time limit.')), this.timeoutMs);
        });
        const html = await Promise.race([work, cancelled]).finally(() => {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
        });
        this.finish(node, html, stage);
        return stage;
    }

    async initialize(render, withContext) {
        this.withContext = withContext;
        const stage = await this.renderNode(this.node(this.page, ROOT, render));
        if (this.disposed) throw new Error('Reactive render was cancelled.');
        this.nodes = stage;
        this.enabled = [...stage.values()].some(node => node.jsx);
        const html = stage.get(ROOT).html;
        return this.enabled ? html : html.replace(/<!--\/?rw:c[0-9a-f]+-->/g, '');
    }

    descendants(id, target = new Set()) {
        target.add(id);
        for (const child of this.nodes.get(id).children) this.descendants(child, target);
        return target;
    }

    commit(id, stage) {
        const replaced = this.descendants(id);
        if (this.nodes.size - replaced.size + stage.size > MAX_OWNERS) throw new Error('Reactive render exceeds the 1024 owner limit.');
        const next = new Map([...this.nodes].filter(([key]) => !replaced.has(key)));
        for (const [key, value] of stage) next.set(key, value);
        if (id !== ROOT) {
            const html = stage.get(id).html;
            for (const [key, node] of next) if (!stage.has(key)) next.set(key, { ...node, html: replaceBoundary(node.html, id, html) });
        }
        const retainedBytes = [...next.values()].reduce((total, entry) => total + Buffer.byteLength(entry.html), 0);
        if (retainedBytes > MAX_HTML_BYTES) throw new Error('Reactive HTML exceeds the 1 MiB snapshot limit.');
        this.nodes = next;
    }

    invalidate(owner, name, payload) {
        if (this.disposed) return;
        for (const [id, node] of this.nodes) if (node.dependencies.get(owner)?.has(name)) this.dirty.add(id);
        this.states.set(`${ownerId(payload.component)}:${name}`, payload);
        this.schedule();
    }

    schedule() {
        if (!this.socket || this.pending || this.running || this.disposed) return;
        this.pending = setImmediate(() => {
            this.pending = null;
            this.flush().catch(error => {
                // A failing application logger must not turn a contained render error into an unhandled rejection.
                Promise.resolve().then(() => this.onError(error)).catch(() => {});
                this.socket?.close(1011, 'Page render failed');
            });
        });
    }

    async attach(socket, states) {
        this.socket = socket;
        this.connection = new AbortController();
        this.generation += 1;
        for (const payload of states) this.states.set(`${ownerId(payload.component)}:${payload.name}`, payload);
        this.dirty.add(ROOT);
        this.snapshot = true;
        return this.flush();
    }

    detach() {
        this.socket = null;
        this.connection.abort();
        this.generation += 1;
        clearImmediate(this.pending);
        this.pending = null;
        this.dirty.clear();
        this.states.clear();
    }

    flush() {
        if (this.running) return this.running;
        this.running = this.performFlush().finally(() => {
            this.running = null;
            if (this.dirty.size || this.states.size) this.schedule();
        });
        return this.running;
    }

    async performFlush() {
        const socket = this.socket;
        const generation = this.generation;
        const dirty = [...this.dirty];
        const states = [...this.states.values()];
        const snapshot = this.snapshot;
        this.snapshot = false;
        this.dirty.clear();
        this.states.clear();
        const covered = new Set();
        const patches = [];
        // Parents must be committed before descendants, regardless of the order their state changed.
        dirty.sort((a, b) => a === ROOT ? -1 : b === ROOT ? 1 : a.length - b.length);
        for (const id of dirty) {
            if (covered.has(id) || !this.nodes.has(id)) continue;
            for (const child of this.descendants(id)) covered.add(child);
            const previous = this.nodes.get(id);
            let stage;
            try { stage = await this.renderNode(previous, this.connection.signal); }
            catch (error) {
                if (this.disposed || generation !== this.generation) return;
                throw error;
            }
            if (this.disposed || generation !== this.generation) return;
            const html = stage.get(id).html;
            this.commit(id, stage);
            if (snapshot || html !== previous.html) patches.push({ id, html: id === ROOT ? this.document(html) : html });
        }
        const explicit = states.filter(payload => {
            const node = this.nodes.get(ownerId(payload.component));
            return node && [...node.html.matchAll(/\b(?:data-rw-state|rw-bind)\s*=\s*["']([^"']+)["']/g)].some(match => match[1] === payload.name);
        });
        if (!this.disposed && generation === this.generation && socket && (patches.length || explicit.length)) {
            socket.sendEvent('redweb:patch', { patches, states: explicit });
        }
    }

    dispose() {
        this.disposed = true;
        this.detach();
        this.controller.abort();
        this.parentSignal.removeEventListener('abort', this.abort);
        this.nodes.clear();
        this.withContext = null;
        this.page = null;
    }
}

module.exports = ReactiveRenderer;
