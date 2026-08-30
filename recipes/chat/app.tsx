import { start, type LiveHtmlServerOptions } from 'redweb';
import { createChatroomPage } from './chatroom';

export function createApp(options: Omit<LiveHtmlServerOptions, 'pages'> = {}) {
    return start(createChatroomPage(), { port: Number(process.env.PORT ?? 8181), templateRoot: __dirname, ...options });
}

if (require.main === module) createApp();
