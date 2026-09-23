import { HtmlFragment, component, defineSite, html } from 'redweb';

interface CardProperties {
    title: string;
    children?: import('redweb/jsx-runtime').Child;
}

const Card = component(({ title, children }: CardProperties) => (
    <article class="card" data-title={title}>
        <h2>{title}</h2>
        {children}
    </article>
));

const cards = [{ id: 1, title: 'First' }] as const;
const content: HtmlFragment = (
    <main aria-label="Cards">
        <label htmlFor="name">Name</label>
        <input id="name" disabled />
        {cards.map(card => <Card key={card.id} title={card.title}><p>{html`Ready`}</p></Card>)}
    </main>
);
void content;

const site = defineSite({ layout: content => <body>{content}</body> });
@site.page('/', { live: false })
class JsxPage {
    render() { return <><h1>JSX</h1><Card title="Simple" /></>; }
}
void JsxPage;

// @ts-expect-error Missing required title.
const missingProperty = <Card />;
void missingProperty;

@component()
class StatefulComponent {
    render() { return <p>Owned component</p>; }
}
class ComponentPage {
    panel = new StatefulComponent();
    render() { return <main>{this.panel}</main>; }
}
void ComponentPage;
class AsyncComponent { async render() { return <p>Async is not supported</p>; } }
// @ts-expect-error Class components must render synchronously.
const asyncChild = <main>{new AsyncComponent()}</main>;
void asyncChild;
