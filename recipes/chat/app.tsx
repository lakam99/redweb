import { defineApp } from 'redweb';
import { ChatroomPage } from './chatroom';

export const app = defineApp({ pages: [ChatroomPage], port: Number(process.env.PORT ?? 8181), templateRoot: __dirname });

if (require.main === module) void app.run().catch(error => { console.error(error); process.exitCode = 1; });
