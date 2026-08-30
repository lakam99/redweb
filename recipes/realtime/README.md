## Realtime starter

`CounterPage` owns its state on the server. `shared: true` deliberately shares the counter between visitors.
The browser button invokes only the decorated `increment` action; it does not supply the new count.
Open two tabs to check the broadcast. State is in memory and resets when the server restarts.

`<output>{this.count}</output>` updates automatically because the page reads decorated state during rendering.
No repeated binding name or browser-side state is needed. State changes are assignment-driven; render methods must not modify state.
