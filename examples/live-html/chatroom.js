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
exports.ChatroomPage = exports.ChatroomComponent = exports.chatInputs = void 0;
exports.createChatroomPage = createChatroomPage;
const jsx_runtime_1 = require('../../jsx-runtime');
const redweb_1 = require('../..');
const zod_1 = require("zod");
const MAX_VISIBLE_MEMBERS = 100;
const visibleText = (maximum) => zod_1.z.string()
    .transform(value => value.normalize('NFKC').trim())
    .pipe(zod_1.z.string().min(1).max(maximum).regex(/^[^\p{Cc}\p{Cf}]+$/u));
exports.chatInputs = {
    join: zod_1.z.object({ name: visibleText(40) }).strict(),
    send: zod_1.z.object({ message: visibleText(500) }).strict(),
};
class ChatRoom {
    history = [];
    nextMessageId = 0;
    participants = new Set();
    online = new Set();
    join(participant) {
        const name = participant.displayName.toLocaleLowerCase();
        if ([...this.participants].some(member => member !== participant && member.displayName.toLocaleLowerCase() === name))
            return false;
        this.participants.add(participant);
        this.online.add(participant);
        participant.updateMessages(this.history);
        this.publishPresence();
        return true;
    }
    disconnect(participant) {
        if (this.online.delete(participant))
            this.publishPresence();
    }
    leave(participant) {
        this.online.delete(participant);
        if (this.participants.delete(participant))
            this.publishPresence();
    }
    send(participant, text) {
        if (!this.online.has(participant))
            return false;
        this.history = [...this.history, { id: ++this.nextMessageId, sender: participant.displayName, text }].slice(-100);
        for (const member of this.participants)
            member.updateMessages(this.history);
        return true;
    }
    publishPresence() {
        const members = [...this.online].map(participant => participant.displayName);
        for (const participant of this.participants)
            participant.updatePresence(members);
    }
}
let ChatroomComponent = (() => {
    let _classDecorators = [(0, redweb_1.component)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    let _instanceExtraInitializers = [];
    let _displayName_decorators;
    let _displayName_initializers = [];
    let _displayName_extraInitializers = [];
    let _feedback_decorators;
    let _feedback_initializers = [];
    let _feedback_extraInitializers = [];
    let _messages_decorators;
    let _messages_initializers = [];
    let _messages_extraInitializers = [];
    let _members_decorators;
    let _members_initializers = [];
    let _members_extraInitializers = [];
    let _join_decorators;
    let _send_decorators;
    let _leave_decorators;
    var ChatroomComponent = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            _displayName_decorators = [(0, redweb_1.state)()];
            _feedback_decorators = [(0, redweb_1.state)()];
            _messages_decorators = [(0, redweb_1.state)()];
            _members_decorators = [(0, redweb_1.state)()];
            _join_decorators = [(0, redweb_1.action)({ input: exports.chatInputs.join })];
            _send_decorators = [(0, redweb_1.action)({ input: exports.chatInputs.send })];
            _leave_decorators = [(0, redweb_1.action)()];
            __esDecorate(this, null, _join_decorators, { kind: "method", name: "join", static: false, private: false, access: { has: obj => "join" in obj, get: obj => obj.join }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _send_decorators, { kind: "method", name: "send", static: false, private: false, access: { has: obj => "send" in obj, get: obj => obj.send }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _leave_decorators, { kind: "method", name: "leave", static: false, private: false, access: { has: obj => "leave" in obj, get: obj => obj.leave }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(null, null, _displayName_decorators, { kind: "field", name: "displayName", static: false, private: false, access: { has: obj => "displayName" in obj, get: obj => obj.displayName, set: (obj, value) => { obj.displayName = value; } }, metadata: _metadata }, _displayName_initializers, _displayName_extraInitializers);
            __esDecorate(null, null, _feedback_decorators, { kind: "field", name: "feedback", static: false, private: false, access: { has: obj => "feedback" in obj, get: obj => obj.feedback, set: (obj, value) => { obj.feedback = value; } }, metadata: _metadata }, _feedback_initializers, _feedback_extraInitializers);
            __esDecorate(null, null, _messages_decorators, { kind: "field", name: "messages", static: false, private: false, access: { has: obj => "messages" in obj, get: obj => obj.messages, set: (obj, value) => { obj.messages = value; } }, metadata: _metadata }, _messages_initializers, _messages_extraInitializers);
            __esDecorate(null, null, _members_decorators, { kind: "field", name: "members", static: false, private: false, access: { has: obj => "members" in obj, get: obj => obj.members, set: (obj, value) => { obj.members = value; } }, metadata: _metadata }, _members_initializers, _members_extraInitializers);
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            ChatroomComponent = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        room = __runInitializers(this, _instanceExtraInitializers);
        displayName = __runInitializers(this, _displayName_initializers, '');
        feedback = (__runInitializers(this, _displayName_extraInitializers), __runInitializers(this, _feedback_initializers, ''));
        messages = (__runInitializers(this, _feedback_extraInitializers), __runInitializers(this, _messages_initializers, []));
        members = (__runInitializers(this, _messages_extraInitializers), __runInitializers(this, _members_initializers, []));
        constructor(room) {
            __runInitializers(this, _members_extraInitializers);
            this.room = room;
        }
        connected() { if (this.displayName)
            this.room.join(this); }
        disconnected() { this.room.disconnect(this); }
        disposed() { this.room.leave(this); }
        join({ name }) {
            if (this.displayName)
                return false;
            this.displayName = name;
            if (!this.room.join(this)) {
                this.displayName = '';
                this.feedback = 'That display name is already in use.';
                return false;
            }
            this.feedback = '';
            return true;
        }
        send({ message }) {
            return this.room.send(this, message);
        }
        leave() {
            this.room.leave(this);
            this.displayName = '';
            this.feedback = '';
            this.messages = [];
            this.members = [];
        }
        updateMessages(messages) { this.messages = messages; }
        updatePresence(members) { this.members = members; }
        render() {
            return (0, jsx_runtime_1.jsx)("section", { class: "chatroom", children: this.displayName ? this.roomScreen() : this.joinScreen() });
        }
        joinScreen() {
            return ((0, jsx_runtime_1.jsxs)("section", { class: "join-panel", children: [(0, jsx_runtime_1.jsx)("p", { class: "eyebrow", children: "Live room" }), (0, jsx_runtime_1.jsx)("h1", { children: "Join the chatroom" }), (0, jsx_runtime_1.jsx)("p", { children: "Choose a name once, then chat in realtime with everyone currently in the room." }), this.feedback && (0, jsx_runtime_1.jsx)("p", { class: "form-error", role: "alert", children: this.feedback }), (0, jsx_runtime_1.jsxs)("form", { "rw-submit": "join", class: "join-form", children: [(0, jsx_runtime_1.jsx)("label", { for: "display-name", children: "Display name" }), (0, jsx_runtime_1.jsxs)("div", { class: "input-row", children: [(0, jsx_runtime_1.jsx)("input", { id: "display-name", name: "name", maxlength: "40", autocomplete: "nickname", required: true, autofocus: true }), (0, jsx_runtime_1.jsx)("button", { type: "submit", children: "Join room" })] })] })] }));
        }
        roomScreen() {
            const remaining = this.members.length - MAX_VISIBLE_MEMBERS;
            return ((0, jsx_runtime_1.jsxs)("div", { class: "room-layout", children: [(0, jsx_runtime_1.jsxs)("section", { class: "conversation", children: [(0, jsx_runtime_1.jsxs)("header", { class: "room-header", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("p", { class: "eyebrow", children: "Connected as" }), (0, jsx_runtime_1.jsx)("h1", { children: this.displayName })] }), (0, jsx_runtime_1.jsx)("button", { type: "button", class: "quiet-button", "rw-click": "leave", children: "Leave" })] }), (0, jsx_runtime_1.jsx)("ol", { class: "message-list", "aria-live": "polite", children: this.messages.length ? this.messages.map(entry => ((0, jsx_runtime_1.jsxs)("li", { children: [(0, jsx_runtime_1.jsx)("strong", { children: entry.sender }), (0, jsx_runtime_1.jsx)("p", { children: entry.text })] }, entry.id))) : (0, jsx_runtime_1.jsx)("li", { class: "empty-message", children: "No messages yet. Say hello." }) }), (0, jsx_runtime_1.jsxs)("form", { "rw-submit": "send", class: "composer", children: [(0, jsx_runtime_1.jsx)("label", { class: "sr-only", for: "chat-message", children: "Message" }), (0, jsx_runtime_1.jsx)("input", { id: "chat-message", name: "message", maxlength: "500", autocomplete: "off", placeholder: "Message the room\u2026", required: true, autofocus: true }), (0, jsx_runtime_1.jsx)("button", { type: "submit", children: "Send" })] })] }), (0, jsx_runtime_1.jsxs)("aside", { class: "presence", "aria-label": "People in the room", children: [(0, jsx_runtime_1.jsxs)("p", { class: "eyebrow", children: ["Online \u00B7 ", this.members.length] }), (0, jsx_runtime_1.jsxs)("ul", { children: [this.members.slice(0, MAX_VISIBLE_MEMBERS).map(member => (0, jsx_runtime_1.jsx)("li", { children: member }, member)), remaining > 0 && (0, jsx_runtime_1.jsxs)("li", { class: "more-members", children: ["+", remaining, " more"] })] })] })] }));
        }
    };
    return ChatroomComponent = _classThis;
})();
exports.ChatroomComponent = ChatroomComponent;
function createChatroomPage() {
    const room = new ChatRoom();
    let ChatroomPage = (() => {
        let _classDecorators = [(0, redweb_1.page)('/', { css: 'chatroom.css' })];
        let _classDescriptor;
        let _classExtraInitializers = [];
        let _classThis;
        var ChatroomPage = class {
            static { _classThis = this; }
            static {
                const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
                __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
                ChatroomPage = _classThis = _classDescriptor.value;
                if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
                __runInitializers(_classThis, _classExtraInitializers);
            }
            chat = new ChatroomComponent(room);
            render() { return (0, jsx_runtime_1.jsx)("main", { children: this.chat }); }
        };
        return ChatroomPage = _classThis;
    })();
    return ChatroomPage;
}
/** Default room; the factory remains available when independent rooms are needed. */
exports.ChatroomPage = createChatroomPage();
if (require.main === module)
    void (0, redweb_1.defineApp)({ pages: [exports.ChatroomPage], port: 8080 }).run()
        .catch(error => { console.error(error); process.exitCode = 1; });
