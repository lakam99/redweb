## Chat starter

`src/chatroom.ts` is the canonical Redweb chat component example, included directly rather than a second implementation.
Visitors choose a name once, chat in a shared room, and see live presence. Disconnect removes online presence;
the page session retains its identity briefly for reconnect, then disposal releases it.

Display names are not authenticated identities. History is bounded to 100 messages in memory, not a persistent database.
Use an application-owned persistence service before promising history across restarts or multiple server processes.
