const { LiveHtmlServer, LivePage, action, html, page, state } = require('../..');

class ChatroomPage extends LivePage {
    constructor() {
        super();
        this.history = [];
        this.messages = html``;
    }

    send({ name, message }) {
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

state()(ChatroomPage.prototype, 'messages');
action()(ChatroomPage.prototype, 'send', Object.getOwnPropertyDescriptor(ChatroomPage.prototype, 'send'));
page('/', { template: 'chatroom.htmx', scope: 'shared' })(ChatroomPage);

function createChatroomServer(options = {}) {
    return new LiveHtmlServer({
        port: 8080,
        templateRoot: __dirname,
        pages: [ChatroomPage],
        ...options,
    });
}

if (require.main === module) createChatroomServer();

module.exports = { ChatroomPage, createChatroomServer };
