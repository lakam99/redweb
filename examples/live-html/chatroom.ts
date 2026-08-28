import { action, component, each, html, page, start, state, type HtmlFragment } from 'redweb';

const MAX_VISIBLE_MEMBERS = 100;
const UNSAFE_NAME = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/;

interface JoinForm {
    name?: string;
}

interface MessageForm {
    message?: string;
}

interface StoredMessage {
    sender: string;
    text: string;
}

interface RoomParticipant {
    readonly displayName: string;
    updateMessages(messages: readonly StoredMessage[]): void;
    updatePresence(presence: HtmlFragment): void;
}

function presenceView(members: readonly string[]) {
    const visible = members.slice(0, MAX_VISIBLE_MEMBERS);
    const remaining = members.length - visible.length;
    return html`
        <p class="eyebrow">Online · ${members.length}</p>
        <ul>
            ${each([...visible], member => html`<li>${member}</li>`)}
            ${remaining ? html`<li class="more-members">+${remaining} more</li>` : html``}
        </ul>
    `;
}

class ChatRoom {
    private history: StoredMessage[] = [];
    private readonly participants = new Set<RoomParticipant>();
    private readonly online = new Set<RoomParticipant>();

    join(participant: RoomParticipant) {
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

    disconnect(participant: RoomParticipant) {
        if (!this.online.delete(participant)) return;
        this.publishPresence();
    }

    leave(participant: RoomParticipant) {
        this.online.delete(participant);
        if (!this.participants.delete(participant)) return;
        this.publishPresence();
    }

    send(participant: RoomParticipant, text: string) {
        if (!this.online.has(participant)) return false;
        this.history = [...this.history, { sender: participant.displayName, text }].slice(-100);
        for (const member of this.participants) member.updateMessages(this.history);
        return true;
    }

    private publishPresence() {
        const members = [...this.online].map(participant => participant.displayName);
        const presence = presenceView(members);
        for (const participant of this.participants) participant.updatePresence(presence);
    }
}

@component()
export class ChatroomComponent implements RoomParticipant {
    displayName = '';

    @state()
    screen = this.joinScreen();

    @state()
    messages = this.messageList([]);

    @state()
    presence = presenceView([]);

    constructor(private readonly room: ChatRoom) {}

    connected() {
        if (this.displayName) this.room.join(this);
    }

    disconnected() {
        this.room.disconnect(this);
    }

    disposed() {
        this.room.leave(this);
    }

    @action()
    join({ name }: JoinForm) {
        if (this.displayName) return false;
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

    @action()
    send({ message }: MessageForm) {
        if (typeof message !== 'string') return false;
        const text = message.normalize('NFKC').trim();
        if (!text || text.length > 500 || UNSAFE_NAME.test(text)) return false;
        return this.room.send(this, text);
    }

    @action()
    leave() {
        this.room.leave(this);
        this.displayName = '';
        this.screen = this.joinScreen();
    }

    updateMessages(messages: readonly StoredMessage[]) {
        this.messages = this.messageList(messages);
    }

    updatePresence(presence: HtmlFragment) {
        this.presence = presence;
    }

    render() {
        return html`<section class="chatroom" data-rw-state="screen">${this.screen}</section>`;
    }

    private joinScreen(error = '') {
        const feedback = error ? html`<p class="form-error" role="alert">${error}</p>` : html``;
        return html`
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

    private messageList(messages: readonly StoredMessage[]) {
        return messages.length
            ? each([...messages], entry => html`<li><strong>${entry.sender}</strong><p>${entry.text}</p></li>`)
            : html`<li class="empty-message">No messages yet. Say hello.</li>`;
    }

    private roomScreen() {
        return html`
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
}

export function createChatroomPage() {
    const room = new ChatRoom();

    @page('/', { css: 'chatroom.css' })
    class ChatroomPage {
        chat = new ChatroomComponent(room);

        render() {
            return html`<main>${this.chat}</main>`;
        }
    }

    return ChatroomPage;
}

if (require.main === module) start(createChatroomPage(), { port: 8080 });
