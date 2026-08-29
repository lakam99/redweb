'use strict';

const TYPESCRIPT_CONFIG = `${JSON.stringify({
    extends: 'redweb/tsconfig.json',
    compilerOptions: { rootDir: 'src', outDir: 'dist' },
    include: ['src/**/*.ts', 'src/**/*.tsx'],
}, null, 2)}\n`;

const APP_SOURCE = `import path from 'node:path';
import { page, start } from 'redweb';

@page('/', { css: 'app.css', live: false })
class HomePage {
  render() {
    return (
      <main class="home">
        <span class="eyebrow">Redweb</span>
        <h1>Your server-rendered app is ready.</h1>
        <p>Edit <code>src/app.tsx</code>, then build again.</p>
      </main>
    );
  }
}

start(HomePage, {
  port: Number(process.env.PORT ?? 8181),
  templateRoot: path.resolve('src'),
});
`;

const APP_STYLES = `:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  background: #08090d;
  color: #fff;
}

body { margin: 0; }

.home {
  width: min(42rem, calc(100% - 2rem));
  margin: 18vh auto 0;
}

.eyebrow {
  color: #ff5064;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

h1 {
  margin: 0.75rem 0;
  font-size: clamp(2.5rem, 8vw, 5rem);
  line-height: 0.98;
}

p { color: rgb(255 255 255 / 65%); }
code { color: #ff8795; }
`;

function projectManifest(version) {
    return `${JSON.stringify({
        name: 'redweb-app',
        private: true,
        version: '0.0.0',
        scripts: {
            build: 'tsc',
            start: 'node dist/app.js',
            dev: 'npm run build && npm start',
        },
        dependencies: { redweb: `^${version}` },
        devDependencies: { typescript: '^5.9.3' },
    }, null, 2)}\n`;
}

function projectFiles(version) {
    return Object.freeze([
        Object.freeze({ path: 'package.json', content: projectManifest(version) }),
        Object.freeze({ path: 'tsconfig.json', content: TYPESCRIPT_CONFIG }),
        Object.freeze({ path: 'src/app.tsx', content: APP_SOURCE }),
        Object.freeze({ path: 'src/app.css', content: APP_STYLES }),
    ]);
}

module.exports = { projectFiles };
