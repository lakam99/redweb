## Socket starter

This is a WebSocket service, not an HTML page. Connect to `ws://localhost:8181/events` and send:

```json
{"type":"echo","text":"Hello sockets"}
```

The `/events` route selects the service; `type: "echo"` selects `EchoHandler`. The response has the same type and text.
Add another handler class for another message type. Do not create a second `message.action` dispatcher.
The handler rejects non-string text and text longer than 500 characters. Transport bounds are illustrative; tune and load-test them.
