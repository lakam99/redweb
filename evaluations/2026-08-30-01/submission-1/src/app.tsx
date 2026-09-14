import { action, page, start, state } from 'redweb';

interface Message { id: number; sender: string; text: string }

// All authoritative room data lives on the server, for this process's lifetime.
class Room {
    count = 0;
    messages: readonly Message[] = [];
    private nextId = 0;
    private visitors = new Set<TeamPage>();

    snapshot(visitor: TeamPage) {
        visitor.count = this.count;
        visitor.messages = this.messages;
        visitor.members = [...this.visitors].filter(v => v.displayName).map(v => v.displayName);
    }

    connect(visitor: TeamPage) { this.visitors.add(visitor); this.publish(); }
    disconnect(visitor: TeamPage) { this.visitors.delete(visitor); this.publish(); }
    publish() { for (const visitor of this.visitors) this.snapshot(visitor); }
    increment() { this.count += 1; this.publish(); }
    send(visitor: TeamPage, text: string) {
        if (!this.visitors.has(visitor) || !visitor.displayName) return false;
        this.messages = [...this.messages, { id: ++this.nextId, sender: visitor.displayName, text }].slice(-100);
        this.publish();
        return true;
    }
}

const room = new Room();

@page('/')
class TeamPage {
    @state() count = 0;
    @state() displayName = '';
    @state() feedback = '';
    @state() messages: readonly Message[] = [];
    @state() members: readonly string[] = [];

    loading() { room.snapshot(this); }
    connected() { room.connect(this); }
    disconnected() { room.disconnect(this); }
    disposed() { room.disconnect(this); }

    @action()
    increment() { room.increment(); }

    @action()
    join(input: unknown) {
        if (this.displayName || !input || typeof input !== 'object') return false;
        const name = (input as { name?: unknown }).name;
        if (typeof name !== 'string' || !name.trim() || name.length > 40) {
            this.feedback = 'Enter a name of 1–40 characters.';
            return false;
        }
        this.displayName = name.trim();
        this.feedback = '';
        room.publish();
        return true;
    }

    @action()
    send(input: unknown) {
        if (!input || typeof input !== 'object') return false;
        const text = (input as { message?: unknown }).message;
        if (typeof text !== 'string' || !text.trim() || text.length > 2000) return false;
        return room.send(this, text);
    }

    render() {
        return <main>
            <h1>Team room</h1>
            <section key="counter">
                <h2>Shared counter</h2>
                <output data-testid="count">{this.count}</output>
                <button type="button" data-testid="increment" rw-click="increment">Increment</button>
            </section>
            <section key="identity">
                {this.displayName ? <p>Joined as {this.displayName}</p> :
                    <form rw-submit="join">
                        <label>Name <input name="name" data-testid="name" maxlength="40" required /></label>
                        <button type="submit" data-testid="join">Join</button>
                    </form>}
                <p role="alert">{this.feedback}</p>
            </section>
            <section key="chat">
                <h2>Messages</h2>
                <ol data-testid="messages" aria-live="polite">
                    {this.messages.map(message => <li key={message.id}><strong>{message.sender}</strong>: {message.text}</li>)}
                </ol>
                <form key="composer" rw-submit="send">
                    <label>Message <input name="message" data-testid="message" maxlength="2000" autocomplete="off" required /></label>
                    <button type="submit" data-testid="send" disabled={!this.displayName}>Send</button>
                </form>
            </section>
            <section key="presence">
                <h2>Online</h2>
                <ul data-testid="members">{this.members.map((name, index) => <li key={index}>{name}</li>)}</ul>
            </section>
        </main>;
    }
}

const server = start(TeamPage, {
    port: Number(process.env.PORT ?? 8181),
    bind: '127.0.0.1',
    logger: null,
    heartbeat: { intervalMs: 1000, timeoutMs: 1000 },
    listenCallback: () => {
        const address = server.server.address();
        if (address && typeof address !== 'string') console.log(JSON.stringify({ url: `http://127.0.0.1:${address.port}` }));
    }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void server.shutdown().then(() => process.exit(0)); });
}
