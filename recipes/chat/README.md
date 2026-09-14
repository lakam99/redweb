## Chat starter

`src/chatroom.tsx` is the canonical Redweb chat component example, included directly rather than a second implementation.
The component stores ordinary message/member data and renders it with reactive TSX and stable list keys; no HTML-valued state or explicit binding names are needed.
Visitors choose a name once, chat in a shared room, and see live presence. Disconnect removes online presence;
the page session retains its identity briefly for reconnect, then disposal releases it.

Display names are not authenticated identities. History is bounded to 100 messages in memory, not a persistent database.
Use an application-owned persistence service before promising history across restarts or multiple server processes.

`@action({ input: chatInputs.join })` validates and normalizes the form before `join` runs;
`ActionInput<typeof chatInputs.join>` supplies its TypeScript input type. The same pattern handles messages.
The starter installs Zod as an application dependency; Redweb itself remains validator-independent.
Invalid field values (including repeated names represented as arrays) receive `ACTION_INVALID_INPUT`, keep the draft,
and show Redweb's built-in form feedback. Name collisions remain a room rule with their own friendly message.
Calling a component method directly from server code bypasses transport validation: pass schema-parsed input.
The schemas reject ordinary unexpected fields; Zod may discard reserved object keys such as `__proto__`.
Only the parsed `name` or `message` reaches the corresponding action.

When using the packed `examples/live-html/chatroom.js` directly instead of the generated starter,
install its application validator with `npm install zod`. A cloned-repository development install already
includes it. Redweb's core and the counter example do not require Zod.
