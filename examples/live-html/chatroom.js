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
exports.ChatroomComponent = void 0;
exports.createChatroomPage = createChatroomPage;
const redweb_1 = require('../..');
const MAX_VISIBLE_MEMBERS = 100;
const UNSAFE_NAME = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/;
function presenceView(members) {
    const visible = members.slice(0, MAX_VISIBLE_MEMBERS);
    const remaining = members.length - visible.length;
    return (0, redweb_1.html) `
        <p class="eyebrow">Online · ${members.length}</p>
        <ul>
            ${(0, redweb_1.each)([...visible], member => (0, redweb_1.html) `<li>${member}</li>`)}
            ${remaining ? (0, redweb_1.html) `<li class="more-members">+${remaining} more</li>` : (0, redweb_1.html) ``}
        </ul>
    `;
}
class ChatRoom {
    history = [];
    participants = new Set();
    online = new Set();
    join(participant) {
        const name = participant.displayName.toLocaleLowerCase();
        if ([...this.participants].some(member => member !== participant && member.displayName.toLocaleLowerCase() === name)) {
            return false;
        }
        this.participants.add(participant);
        this.online.add(participant);
        participant.updateMessages(this.history);
        this.publishPresence();
        return true;
    }
    disconnect(participant) {
        if (!this.online.delete(participant))
            return;
        this.publishPresence();
    }
    leave(participant) {
        this.online.delete(participant);
        if (!this.participants.delete(participant))
            return;
        this.publishPresence();
    }
    send(participant, text) {
        if (!this.online.has(participant))
            return false;
        this.history = [...this.history, { sender: participant.displayName, text }].slice(-100);
        for (const member of this.participants)
            member.updateMessages(this.history);
        return true;
    }
    publishPresence() {
        const members = [...this.online].map(participant => participant.displayName);
        const presence = presenceView(members);
        for (const participant of this.participants)
            participant.updatePresence(presence);
    }
}
let ChatroomComponent = (() => {
    let _classDecorators = [(0, redweb_1.component)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    let _instanceExtraInitializers = [];
    let _screen_decorators;
    let _screen_initializers = [];
    let _screen_extraInitializers = [];
    let _messages_decorators;
    let _messages_initializers = [];
    let _messages_extraInitializers = [];
    let _presence_decorators;
    let _presence_initializers = [];
    let _presence_extraInitializers = [];
    let _join_decorators;
    let _send_decorators;
    let _leave_decorators;
    var ChatroomComponent = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            _screen_decorators = [(0, redweb_1.state)()];
            _messages_decorators = [(0, redweb_1.state)()];
            _presence_decorators = [(0, redweb_1.state)()];
            _join_decorators = [(0, redweb_1.action)()];
            _send_decorators = [(0, redweb_1.action)()];
            _leave_decorators = [(0, redweb_1.action)()];
            __esDecorate(this, null, _join_decorators, { kind: "method", name: "join", static: false, private: false, access: { has: obj => "join" in obj, get: obj => obj.join }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _send_decorators, { kind: "method", name: "send", static: false, private: false, access: { has: obj => "send" in obj, get: obj => obj.send }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _leave_decorators, { kind: "method", name: "leave", static: false, private: false, access: { has: obj => "leave" in obj, get: obj => obj.leave }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(null, null, _screen_decorators, { kind: "field", name: "screen", static: false, private: false, access: { has: obj => "screen" in obj, get: obj => obj.screen, set: (obj, value) => { obj.screen = value; } }, metadata: _metadata }, _screen_initializers, _screen_extraInitializers);
            __esDecorate(null, null, _messages_decorators, { kind: "field", name: "messages", static: false, private: false, access: { has: obj => "messages" in obj, get: obj => obj.messages, set: (obj, value) => { obj.messages = value; } }, metadata: _metadata }, _messages_initializers, _messages_extraInitializers);
            __esDecorate(null, null, _presence_decorators, { kind: "field", name: "presence", static: false, private: false, access: { has: obj => "presence" in obj, get: obj => obj.presence, set: (obj, value) => { obj.presence = value; } }, metadata: _metadata }, _presence_initializers, _presence_extraInitializers);
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            ChatroomComponent = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        room = __runInitializers(this, _instanceExtraInitializers);
        displayName = '';
        screen = __runInitializers(this, _screen_initializers, this.joinScreen());
        messages = (__runInitializers(this, _screen_extraInitializers), __runInitializers(this, _messages_initializers, this.messageList([])));
        presence = (__runInitializers(this, _messages_extraInitializers), __runInitializers(this, _presence_initializers, presenceView([])));
        constructor(room) {
            __runInitializers(this, _presence_extraInitializers);
            this.room = room;
        }
        connected() {
            if (this.displayName)
                this.room.join(this);
        }
        disconnected() {
            this.room.disconnect(this);
        }
        disposed() {
            this.room.leave(this);
        }
        join({ name }) {
            if (this.displayName)
                return false;
            if (typeof name !== 'string') {
                this.screen = this.joinScreen('Display name must be text.');
                return false;
            }
            const displayName = name.normalize('NFKC').trim();
            if (!displayName || displayName.length > 40 || UNSAFE_NAME.test(displayName)) {
                this.screen = this.joinScreen('Choose a visible display name of at most 40 characters.');
                return false;
            }
            this.displayName = displayName;
            if (this.room.join(this)) {
                this.screen = this.roomScreen();
                return true;
            }
            this.displayName = '';
            this.screen = this.joinScreen('That display name is already in use.');
            return false;
        }
        send({ message }) {
            if (typeof message !== 'string')
                return false;
            const text = message.normalize('NFKC').trim();
            if (!text || text.length > 500 || UNSAFE_NAME.test(text))
                return false;
            return this.room.send(this, text);
        }
        leave() {
            this.room.leave(this);
            this.displayName = '';
            this.screen = this.joinScreen();
        }
        updateMessages(messages) {
            this.messages = this.messageList(messages);
        }
        updatePresence(presence) {
            this.presence = presence;
        }
        render() {
            return (0, redweb_1.html) `<section class="chatroom" data-rw-state="screen">${this.screen}</section>`;
        }
        joinScreen(error = '') {
            const feedback = error ? (0, redweb_1.html) `<p class="form-error" role="alert">${error}</p>` : (0, redweb_1.html) ``;
            return (0, redweb_1.html) `
            <section class="join-panel">
                <p class="eyebrow">Live room</p>
                <h1>Join the chatroom</h1>
                <p>Choose a name once, then chat in realtime with everyone currently in the room.</p>
                ${feedback}
                <form rw-submit="join" class="join-form">
                    <label for="display-name">Display name</label>
                    <div class="input-row">
                        <input id="display-name" name="name" maxlength="40" autocomplete="nickname" required autofocus>
                        <button type="submit">Join room</button>
                    </div>
                </form>
            </section>
        `;
        }
        messageList(messages) {
            return messages.length
                ? (0, redweb_1.each)([...messages], entry => (0, redweb_1.html) `<li><strong>${entry.sender}</strong><p>${entry.text}</p></li>`)
                : (0, redweb_1.html) `<li class="empty-message">No messages yet. Say hello.</li>`;
        }
        roomScreen() {
            return (0, redweb_1.html) `
            <div class="room-layout">
                <section class="conversation">
                    <header class="room-header">
                        <div><p class="eyebrow">Connected as</p><h1>${this.displayName}</h1></div>
                        <button type="button" class="quiet-button" rw-click="leave">Leave</button>
                    </header>
                    <ol class="message-list" aria-live="polite" data-rw-state="messages">${this.messages}</ol>
                    <form rw-submit="send" class="composer">
                        <label class="sr-only" for="chat-message">Message</label>
                        <input id="chat-message" name="message" maxlength="500" autocomplete="off" placeholder="Message the room…" required autofocus>
                        <button type="submit">Send</button>
                    </form>
                </section>
                <aside class="presence" aria-label="People in the room" data-rw-state="presence">${this.presence}</aside>
            </div>
        `;
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
            render() {
                return (0, redweb_1.html) `<main>${this.chat}</main>`;
            }
        };
        return ChatroomPage = _classThis;
    })();
    return ChatroomPage;
}
if (require.main === module)
    (0, redweb_1.start)(createChatroomPage(), { port: 8080 });
