import { action, component, each, html, page, start, state } from 'redweb';

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
    refresh(messages: readonly StoredMessage[], members: readonly string[]): void;
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
        this.publish();
        return true;
    }

    disconnect(participant: RoomParticipant) {
        if (!this.online.delete(participant)) return;
        this.publish();
    }

    leave(participant: RoomParticipant) {
        this.online.delete(participant);
        if (!this.participants.delete(participant)) return;
        this.publish();
    }

    send(participant: RoomParticipant, text: string) {
        if (!this.online.has(participant)) return false;
        this.history = [...this.history, { sender: participant.displayName, text }].slice(-100);
        this.publish();
        return true;
    }

    private publish() {
        const members = [...this.online].map(participant => participant.displayName);
        for (const participant of this.participants) participant.refresh(this.history, members);
    }
}

const room = new ChatRoom();

@component()
export class ChatroomComponent implements RoomParticipant {
    displayName = '';

    @state()
    screen = this.joinScreen();

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
        const displayName = String(name || '').trim().slice(0, 40);
        if (!displayName) {
            this.screen = this.joinScreen('Choose a display name before joining.');
            return false;
        }
        this.displayName = displayName;
        if (this.room.join(this)) return true;
        this.displayName = '';
        this.screen = this.joinScreen('That display name is already in use.');
        return false;
    }

    @action()
    send({ message }: MessageForm) {
        const text = String(message || '').trim().slice(0, 500);
        if (!text) return false;
        return this.room.send(this, text);
    }

    @action()
    leave() {
        this.room.leave(this);
        this.displayName = '';
        this.screen = this.joinScreen();
    }

    refresh(messages: readonly StoredMessage[], members: readonly string[]) {
        this.screen = this.roomScreen(messages, members);
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

    private roomScreen(messages: readonly StoredMessage[], members: readonly string[]) {
        const messageItems = messages.length
            ? each([...messages], entry => html`<li><strong>${entry.sender}</strong><p>${entry.text}</p></li>`)
            : html`<li class="empty-message">No messages yet. Say hello.</li>`;
        const memberItems = each([...members], member => html`<li>${member}</li>`);
        return html`
            <div class="room-layout">
                <section class="conversation">
                    <header class="room-header">
                        <div><p class="eyebrow">Connected as</p><h1>${this.displayName}</h1></div>
                        <button type="button" class="quiet-button" rw-click="leave">Leave</button>
                    </header>
                    <ol class="message-list" aria-live="polite">${messageItems}</ol>
                    <form rw-submit="send" class="composer">
                        <label class="sr-only" for="chat-message">Message</label>
                        <input id="chat-message" name="message" maxlength="500" autocomplete="off" placeholder="Message the room…" required autofocus>
                        <button type="submit">Send</button>
                    </form>
                </section>
                <aside class="presence" aria-label="People in the room">
                    <p class="eyebrow">Online · ${members.length}</p>
                    <ul>${memberItems}</ul>
                </aside>
            </div>
        `;
    }
}

@page('/', { css: 'chatroom.css' })
export class ChatroomPage {
    chat = new ChatroomComponent(room);

    render() {
        return html`<main>${this.chat}</main>`;
    }
}

if (require.main === module) start(ChatroomPage, { port: 8080 });
