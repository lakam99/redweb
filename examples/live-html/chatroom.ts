import type { HtmlFragment, LiveHtmlServerOptions } from 'redweb';

const { LiveHtmlServer, LivePage, action, html, page, state }: typeof import('redweb') = require('../..');

interface ChatMessage {
    name?: string;
    message?: string;
}

interface StoredMessage {
    sender: string;
    text: string;
}

@page('/', { template: 'chatroom.htmx', scope: 'shared' })
export class ChatroomPage extends LivePage {
    private history: StoredMessage[] = [];

    @state()
    messages: HtmlFragment = html``;

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

export function createChatroomServer(options: Omit<LiveHtmlServerOptions, 'pages'> = {}) {
    return new LiveHtmlServer({
        port: 8080,
        templateRoot: __dirname,
        pages: [ChatroomPage],
        ...options,
    });
}

if (require.main === module) createChatroomServer();
