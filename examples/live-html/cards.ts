import { action, html, page, start, state, view } from 'redweb';

interface Card {
    title: string;
    description: string;
}

@page('/', { template: 'cards.html', css: 'cards.css' })
export class CardsPage {
    @state()
    cards: Card[] = [
        { title: 'Realtime', description: 'State changes arrive over the existing socket.' },
        { title: 'Safe HTML', description: 'Card values are escaped by default.' },
    ];

    @view('cards')
    card(card: Card) {
        return html`
            <article class="card">
                <h2>${card.title}</h2>
                <p>${card.description}</p>
            </article>
        `;
    }

    @action()
    add() {
        this.cards = [...this.cards, {
            title: `Card ${this.cards.length + 1}`,
            description: 'Rendered on the server and synchronized without client code.',
        }];
    }
}

if (require.main === module) start(CardsPage, { port: 8080 });
