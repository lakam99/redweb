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
exports.CardsPage = void 0;
const redweb_1 = require('../..');
let CardsPage = (() => {
    let _classDecorators = [(0, redweb_1.page)('/', { template: 'cards.html', css: 'cards.css', shared: true })];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    let _instanceExtraInitializers = [];
    let _cards_decorators;
    let _cards_initializers = [];
    let _cards_extraInitializers = [];
    let _card_decorators;
    let _add_decorators;
    var CardsPage = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            _cards_decorators = [(0, redweb_1.state)()];
            _card_decorators = [(0, redweb_1.view)('cards')];
            _add_decorators = [(0, redweb_1.action)()];
            __esDecorate(this, null, _card_decorators, { kind: "method", name: "card", static: false, private: false, access: { has: obj => "card" in obj, get: obj => obj.card }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _add_decorators, { kind: "method", name: "add", static: false, private: false, access: { has: obj => "add" in obj, get: obj => obj.add }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(null, null, _cards_decorators, { kind: "field", name: "cards", static: false, private: false, access: { has: obj => "cards" in obj, get: obj => obj.cards, set: (obj, value) => { obj.cards = value; } }, metadata: _metadata }, _cards_initializers, _cards_extraInitializers);
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            CardsPage = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        cards = (__runInitializers(this, _instanceExtraInitializers), __runInitializers(this, _cards_initializers, [
            { title: 'Realtime', description: 'State changes arrive over the existing socket.' },
            { title: 'Safe HTML', description: 'Card values are escaped by default.' },
        ]));
        card(card) {
            return (0, redweb_1.html) `
            <article class="card">
                <h2>${card.title}</h2>
                <p>${card.description}</p>
            </article>
        `;
        }
        add() {
            this.cards = [...this.cards, {
                    title: `Card ${this.cards.length + 1}`,
                    description: 'Rendered on the server and synchronized without client code.',
                }];
        }
        constructor() {
            __runInitializers(this, _cards_extraInitializers);
        }
    };
    return CardsPage = _classThis;
})();
exports.CardsPage = CardsPage;
if (require.main === module)
    (0, redweb_1.start)(CardsPage, { port: 8080 });
