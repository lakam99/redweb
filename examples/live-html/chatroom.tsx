import { action, component, page, start, state, type ActionInput } from 'redweb';
import { z } from 'zod';

const MAX_VISIBLE_MEMBERS = 100;
const visibleText = (maximum: number) => z.string()
    .transform(value => value.normalize('NFKC').trim())
    .pipe(z.string().min(1).max(maximum).regex(/^[^\p{Cc}\p{Cf}]+$/u));
export const chatInputs = {
    join: z.object({ name: visibleText(40) }).strict(),
    send: z.object({ message: visibleText(500) }).strict(),
};

interface StoredMessage { id: number; sender: string; text: string; }
interface RoomParticipant {
    readonly displayName: string;
    updateMessages(messages: readonly StoredMessage[]): void;
    updatePresence(members: readonly string[]): void;
}

class ChatRoom {
    private history: readonly StoredMessage[] = [];
    private nextMessageId = 0;
    private readonly participants = new Set<RoomParticipant>();
    private readonly online = new Set<RoomParticipant>();

    join(participant: RoomParticipant) {
        const name = participant.displayName.toLocaleLowerCase();
        if ([...this.participants].some(member => member !== participant && member.displayName.toLocaleLowerCase() === name)) return false;
        this.participants.add(participant);
        this.online.add(participant);
        participant.updateMessages(this.history);
        this.publishPresence();
        return true;
    }

    disconnect(participant: RoomParticipant) {
        if (this.online.delete(participant)) this.publishPresence();
    }

    leave(participant: RoomParticipant) {
        this.online.delete(participant);
        if (this.participants.delete(participant)) this.publishPresence();
    }

    send(participant: RoomParticipant, text: string) {
        if (!this.online.has(participant)) return false;
        this.history = [...this.history, { id: ++this.nextMessageId, sender: participant.displayName, text }].slice(-100);
        for (const member of this.participants) member.updateMessages(this.history);
        return true;
    }

    private publishPresence() {
        const members = [...this.online].map(participant => participant.displayName);
        for (const participant of this.participants) participant.updatePresence(members);
    }
}

@component()
export class ChatroomComponent implements RoomParticipant {
    @state() displayName = '';
    @state() feedback = '';
    @state() messages: readonly StoredMessage[] = [];
    @state() members: readonly string[] = [];

    constructor(private readonly room: ChatRoom) {}

    connected() { if (this.displayName) this.room.join(this); }
    disconnected() { this.room.disconnect(this); }
    disposed() { this.room.leave(this); }

    @action({ input: chatInputs.join })
    join({ name }: ActionInput<typeof chatInputs.join>) {
        if (this.displayName) return false;
        this.displayName = name;
        if (!this.room.join(this)) {
            this.displayName = '';
            this.feedback = 'That display name is already in use.';
            return false;
        }
        this.feedback = '';
        return true;
    }

    @action({ input: chatInputs.send })
    send({ message }: ActionInput<typeof chatInputs.send>) {
        return this.room.send(this, message);
    }

    @action()
    leave() {
        this.room.leave(this);
        this.displayName = '';
        this.feedback = '';
        this.messages = [];
        this.members = [];
    }

    updateMessages(messages: readonly StoredMessage[]) { this.messages = messages; }
    updatePresence(members: readonly string[]) { this.members = members; }

    render() {
        return <section class="chatroom">{this.displayName ? this.roomScreen() : this.joinScreen()}</section>;
    }

    private joinScreen() {
        return (
            <section class="join-panel">
                <p class="eyebrow">Live room</p>
                <h1>Join the chatroom</h1>
                <p>Choose a name once, then chat in realtime with everyone currently in the room.</p>
                {this.feedback && <p class="form-error" role="alert">{this.feedback}</p>}
                <form rw-submit="join" class="join-form">
                    <label for="display-name">Display name</label>
                    <div class="input-row">
                        <input id="display-name" name="name" maxlength="40" autocomplete="nickname" required autofocus />
                        <button type="submit">Join room</button>
                    </div>
                </form>
            </section>
        );
    }

    private roomScreen() {
        const remaining = this.members.length - MAX_VISIBLE_MEMBERS;
        return (
            <div class="room-layout">
                <section class="conversation">
                    <header class="room-header">
                        <div><p class="eyebrow">Connected as</p><h1>{this.displayName}</h1></div>
                        <button type="button" class="quiet-button" rw-click="leave">Leave</button>
                    </header>
                    <ol class="message-list" aria-live="polite">
                        {this.messages.length ? this.messages.map(entry => (
                            <li key={entry.id}><strong>{entry.sender}</strong><p>{entry.text}</p></li>
                        )) : <li class="empty-message">No messages yet. Say hello.</li>}
                    </ol>
                    <form rw-submit="send" class="composer">
                        <label class="sr-only" for="chat-message">Message</label>
                        <input id="chat-message" name="message" maxlength="500" autocomplete="off" placeholder="Message the room…" required autofocus />
                        <button type="submit">Send</button>
                    </form>
                </section>
                <aside class="presence" aria-label="People in the room">
                    <p class="eyebrow">Online · {this.members.length}</p>
                    <ul>
                        {this.members.slice(0, MAX_VISIBLE_MEMBERS).map(member => <li key={member}>{member}</li>)}
                        {remaining > 0 && <li class="more-members">+{remaining} more</li>}
                    </ul>
                </aside>
            </div>
        );
    }
}

export function createChatroomPage() {
    const room = new ChatRoom();

    @page('/', { css: 'chatroom.css' })
    class ChatroomPage {
        chat = new ChatroomComponent(room);
        render() { return <main>{this.chat}</main>; }
    }

    return ChatroomPage;
}

if (require.main === module) start(createChatroomPage(), { port: 8080 });
