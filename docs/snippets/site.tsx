import { defineApp, defineSite } from 'redweb';

const site = defineSite({
    css: 'site.css',
    layout: content => <body>
        <nav><a href="/">Home</a> · <a href="/about">About</a></nav>
        <main>{content}</main>
    </body>,
});

@site.page('/', { head: { title: 'Home' } })
class HomePage {
    render() { return <h1>Welcome to Redweb</h1>; }
}

@site.page('/about', { head: { title: 'About' } })
class AboutPage {
    render() { return <p>Two pages, one layout, no browser framework.</p>; }
}

const app = defineApp({ pages: [HomePage, AboutPage] });
app.run();
