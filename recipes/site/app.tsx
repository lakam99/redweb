import { defineSite, start, type LiveHtmlStartOptions } from 'redweb';

const site = defineSite({
    css: 'app.css',
    layout: content => <body><nav><a href="/">Home</a> · <a href="/about">About</a></nav>{content}</body>,
});

@site.page('/', { head: { title: 'My Redweb site', description: 'A server-rendered TypeScript site.' } })
export class HomePage {
    render() {
        return <main class="home"><h1>Your server-rendered app is ready.</h1><p>Edit src/app.tsx to make it yours.</p></main>;
    }
}

@site.page('/about', { head: { title: 'About' } })
export class AboutPage {
    render() { return <main class="home"><h1>About</h1><p>Shared layout, separate pages, no browser JavaScript.</p></main>; }
}

export function createApp(options: LiveHtmlStartOptions = {}) {
    return start([HomePage, AboutPage], { port: Number(process.env.PORT ?? 8181), templateRoot: __dirname, ...options });
}

if (require.main === module) createApp();
