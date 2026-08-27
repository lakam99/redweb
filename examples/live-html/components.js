"use strict";
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComponentsPage = exports.CounterComponent = void 0;
const redweb_1 = require('../..');
let CounterComponent = (() => {
    let _classDecorators = [(0, redweb_1.component)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    let _instanceExtraInitializers = [];
    let _count_decorators;
    let _count_initializers = [];
    let _count_extraInitializers = [];
    let _increment_decorators;
    var CounterComponent = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            _count_decorators = [(0, redweb_1.state)()];
            _increment_decorators = [(0, redweb_1.action)()];
            __esDecorate(this, null, _increment_decorators, { kind: "method", name: "increment", static: false, private: false, access: { has: obj => "increment" in obj, get: obj => obj.increment }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(null, null, _count_decorators, { kind: "field", name: "count", static: false, private: false, access: { has: obj => "count" in obj, get: obj => obj.count, set: (obj, value) => { obj.count = value; } }, metadata: _metadata }, _count_initializers, _count_extraInitializers);
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            CounterComponent = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        label = __runInitializers(this, _instanceExtraInitializers);
        count = __runInitializers(this, _count_initializers, 0);
        constructor(label) {
            __runInitializers(this, _count_extraInitializers);
            this.label = label;
        }
        increment() {
            this.count += 1;
        }
        render() {
            return (0, redweb_1.html) `
            <article class="counter-card">
                <h2>${this.label}</h2>
                <output data-rw-state="count">${this.count}</output>
                <button type="button" rw-click="increment">Increment on the server</button>
            </article>
        `;
        }
    };
    return CounterComponent = _classThis;
})();
exports.CounterComponent = CounterComponent;
let ComponentsPage = (() => {
    let _classDecorators = [(0, redweb_1.page)('/', { css: 'components.css' })];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var ComponentsPage = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            ComponentsPage = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        primary = new CounterComponent('Primary counter');
        secondary = new CounterComponent('Independent counter');
        render() {
            return (0, redweb_1.html) `
            <main>
                <h1>Reusable server components</h1>
                <section class="counter-grid">${this.primary}${this.secondary}</section>
            </main>
        `;
        }
    };
    return ComponentsPage = _classThis;
})();
exports.ComponentsPage = ComponentsPage;
if (require.main === module)
    (0, redweb_1.start)(ComponentsPage, { port: 8080 });
