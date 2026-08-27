import { action, html, page, start, state } from 'redweb';

interface ChatMessage {
    name?: string;
    message?: string;
}

interface StoredMessage {
    sender: string;
    text: string;
}

@page('/', { template: 'chatroom.html', css: 'chatroom.css', shared: true })
export class ChatroomPage {
    private history: StoredMessage[] = [];

    @state()
    messages = html``;

    @action()
    send({ name, message }: ChatMessage) {
        const sender = String(name || 'Guest').trim().slice(0, 40);
        const text = String(message || '').trim().slice(0, 500);
        if (!text) return;
        this.history.push({ sender, text });
        this.history = this.history.slice(-100);
        this.messages = this.history.reduce(
            (list, entry) => html`${list}<li><strong>${entry.sender}</strong>: ${entry.text}</li>`,
            html``
        );
    }
}

if (require.main === module) start(ChatroomPage, { port: 8080 });
