import { start, type LiveHtmlStartOptions } from 'redweb';
import { createChatroomPage } from './chatroom';

export function createApp(options: LiveHtmlStartOptions = {}) {
    return start(createChatroomPage(), { port: Number(process.env.PORT ?? 8181), templateRoot: __dirname, ...options });
}

if (require.main === module) createApp();
