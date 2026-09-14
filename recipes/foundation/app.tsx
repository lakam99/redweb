import { defineApp, page } from 'redweb';

@page('/', { live: false, css: 'app.css' })
export class HomePage {
    render() {
        return <main class="home"><h1>Redweb is ready.</h1><p>Replace this page with your application.</p></main>;
    }
}

export const app = defineApp({ pages: [HomePage], port: Number(process.env.PORT ?? 8181), templateRoot: __dirname });

if (require.main === module) app.run();
