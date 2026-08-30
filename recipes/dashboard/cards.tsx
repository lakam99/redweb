import { action, component, state, type ActionInput, type LivePageConnectionContext, type LivePageRequestContext } from 'redweb';
import { z } from 'zod';
import { sessionToken } from './auth';
import { DashboardStore, MAX_CARDS, type Card } from './store';

const addInput = z.object({ title: z.string().trim().min(1).max(80).regex(/^[^\p{Cc}\p{Cf}]+$/u) }).strict();
const removeInput = z.object({ id: z.string().uuid() }).strict();
const tokenOf = (context: LivePageRequestContext) => sessionToken(context.request.get('cookie'));

interface Subscriber { token: string; update(): void; close(): void; }

/** Single-process notifications; SQLite remains the source of truth on every connection. */
export class PrivateCards {
    private readonly accounts = new Map<string, Set<Subscriber>>();
    constructor(readonly store: DashboardStore) {}

    allowed(context: LivePageRequestContext) {
        const session = this.store.session(tokenOf(context));
        return !!session && session.account === context.principal && !context.signal.aborted;
    }

    subscribe(context: LivePageConnectionContext, update: (cards: Card[]) => void): () => void {
        const token = tokenOf(context);
        const session = this.store.session(token);
        if (!session || !this.allowed(context)) throw new Error('Sign in again.');
        let group = this.accounts.get(session.account);
        if (!group) this.accounts.set(session.account, group = new Set());
        let closed = false;
        const subscriber: Subscriber = {
            token, update: () => update(this.store.list(token)),
            close: () => { unsubscribe(); context.socket.close(1008, 'Sign in again.'); },
        };
        const unsubscribe = () => {
            if (closed) return;
            closed = true;
            clearTimeout(expiry);
            context.signal.removeEventListener('abort', unsubscribe);
            group.delete(subscriber);
            if (!group.size && this.accounts.get(session.account) === group) this.accounts.delete(session.account);
        };
        const expiry = setTimeout(subscriber.close, Math.max(1, session.expires - Date.now()));
        expiry.unref();
        group.add(subscriber);
        context.signal.addEventListener('abort', unsubscribe, { once: true });
        try { subscriber.update(); }
        catch (error) { unsubscribe(); throw error; }
        return unsubscribe;
    }

    publish(account: string) {
        for (const subscriber of this.accounts.get(account) ?? []) {
            try {
                if (this.store.session(subscriber.token)?.account === account) subscriber.update();
                else subscriber.close();
            } catch { subscriber.close(); }
        }
    }
}

@component()
export class Cards {
    @state() items: Card[] = [];
    private unsubscribe?: () => void;

    constructor(private readonly cards: PrivateCards) {}
    loading(context: LivePageRequestContext) { this.items = this.cards.store.list(tokenOf(context)); }
    connected(context: LivePageConnectionContext) {
        this.disconnected();
        this.unsubscribe = this.cards.subscribe(context, items => { this.items = items; });
    }
    disconnected() { this.unsubscribe?.(); this.unsubscribe = undefined; }
    disposed() { this.disconnected(); }

    @action({ input: addInput })
    add({ title }: ActionInput<typeof addInput>, context: LivePageConnectionContext) {
        this.cards.publish(this.cards.store.add(tokenOf(context), title));
    }

    @action({ input: removeInput })
    remove({ id }: ActionInput<typeof removeInput>, context: LivePageConnectionContext) {
        this.cards.publish(this.cards.store.remove(tokenOf(context), id));
    }

    render() {
        return <section class="cards" aria-label="Your saved cards">
            <form rw-submit="add">
                <label for="card-title">New card</label>
                <input id="card-title" name="title" maxlength="80" required autocomplete="off" />
                <button type="submit" disabled={this.items.length >= MAX_CARDS}>Add card</button>
            </form>
            <p>{this.items.length} / {MAX_CARDS} cards · saved automatically</p>
            <ul class="card-grid">{this.items.map(card => <li key={card.id} data-card-id={card.id}>
                <h2>{card.title}</h2>
                <form rw-submit="remove">
                    <input type="hidden" name="id" value={card.id} />
                    <button type="submit" aria-label={`Delete ${card.title}`}>Delete</button>
                </form>
            </li>)}</ul>
            {!this.items.length && <p>No cards yet. Add your first one above.</p>}
        </section>;
    }
}
