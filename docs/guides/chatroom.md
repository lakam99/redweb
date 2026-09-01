# Build a chatroom with live presence

Build a shared chatroom where visitors choose a name once, send messages, and see who is online. The starter includes the canonical reusable `ChatroomComponent`, its stylesheet, input validation and real-network tests. You do not write a browser WebSocket handler for every message or member change.

## Explain it like I'm five

The room is a noticeboard managed by the server. Each visitor gets a little window onto it. The room keeps the recent messages and the online list; each visitor's component keeps their name and what their window should show. When the noticeboard changes, the server updates the windows.

## Follow the design

1. The [application entrypoint](../../recipes/chat/app.tsx) starts a page created by `createChatroomPage()`. The component source shown below is copied from the maintained example, not a separate implementation.
2. `ChatRoom` owns shared message/member data. `ChatroomComponent` owns a participant's state, server-callable actions and view. Normal TypeScript conditions choose the join screen or conversation screen.
3. Decorated join/send actions validate form values through the starter's Zod schemas. Redweb provides loading/error feedback; invalid input does not require custom browser glue to preserve the draft.
4. `connected()` restores online participation when a retained participant reconnects. `disconnected()` removes online presence; later disposal releases retained identity. A name reserved briefly for reconnect does not mean the person is still online.
5. State assignments and stable JSX keys update messages and members. A function that returns reusable markup alone would not replace this component's owned lifecycle and actions.

Display names are not authenticated identities. Use the [private dashboard guide](realtime-dashboard.md) and [authorization reference](../ROOM_AUTHORIZATION.md) when your application needs verified accounts and private data.

## Check that it works

Open two tabs at `http://localhost:8181/`, choose different names and send a message. Both should see its sender and text. Close one tab and confirm its online presence disappears once the server observes the disconnect. Abrupt network loss is not necessarily detected immediately; heartbeat and network timing matter. Reconnect is not a promise of durable identity.

The [starter tests](../../recipes/chat/app.test.cjs) exercise actual pages, sockets, server actions, escaped message delivery and disconnect behavior. The package gate repeats them after source removal. Test invalid inputs, browser focus, unsent drafts and reconnects on your supported browsers as well.

## Before promising durable chat

History is bounded to **100 messages in server memory**. It survives neither a process restart nor independent workers. Add application-owned persistence and a deliberate cross-process notification design before promising durable history or distributed rooms. Add authentication, membership authorization and abuse controls before exposing private or public rooms. The raw socket handler starter is a different abstraction; do not replace this component with a second browser message dispatcher merely to update its HTML.
