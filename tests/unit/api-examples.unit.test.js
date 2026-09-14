'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { Documentation } = require('../../src/docs/Documentation');
const root = path.resolve(__dirname, '../..');

test('every current API and showcase example parses as its documented language', () => {
    const docs = new Documentation(root).build();
    for (const entry of [...docs.api, ...docs.examples]) {
        const source = entry.usage || entry.code;
        const result = ts.transpileModule(source, {
            fileName: `${entry.id}.tsx`, reportDiagnostics: true,
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'redweb' },
        });
        expect({ id: entry.id, errors: (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')) })
            .toEqual({ id: entry.id, errors: [] });
    }
});

test('primary examples reuse tested concise sources and keep low-level boundaries honest', () => {
    const docs = new Documentation(root).build();
    const api = id => docs.api.find(entry => entry.id === id);
    const source = name => fs.readFileSync(path.join(root, `docs/snippets/${name}`), 'utf8').replace(/\r\n/g, '\n').trimEnd();
    for (const id of ['livepage', 'livedecorators']) expect(api(id).usage.trimEnd()).toBe(source('counter.tsx'));
    const jsx = docs.pages.find(entry => entry.id === 'guides/jsx-without-react').markdown;
    expect(jsx).toContain(source('site.tsx'));
    expect(jsx).toContain(source('site.css'));
    expect(jsx).not.toMatch(/require\.main|process\.env\.PORT|entrypoint helper/);
    const html = docs.pages.find(entry => entry.id === 'live-html').markdown;
    expect(html).toContain(source('components.tsx'));
    expect(html).not.toContain('<output data-rw-state');
    expect(html).not.toContain('extends LivePage');
    expect(html).not.toContain('<!-- source:');
    expect(api('basehandler').usage).not.toContain('message.action');
    expect(api('socketserver').usage).toContain('server: http.server');
    expect(api('socketserver').usage).not.toContain('createServer');
    expect(api('protocolclient').usage).toContain("socket.addEventListener('open'");
    expect(api('socketregistry').article.watchFor).toContain('unbounded');
    expect(api('sendjson').article.walkthrough.join(' ')).toContain('without inheriting a route policy');
    expect(api('connectedclients').usage).toContain('players.bind(contract)');
    expect(api('socketroute').options.join(' ')).toContain('connections:');
    expect(api('securesocketserver').options.join(' ')).toContain('only when creating an owned HTTPS server');
    expect(api('securesocketserver').methods.find(method => method.name === 'shutdown()').detail).toContain('supplied servers remain open by default');
    expect(api('roomregistry').methods.find(method => method.name === 'socket.joinRoom(roomId)').detail).toContain('Throws when rooms.authorize');
    expect(html).toContain('five-second total application shutdown budget');
    expect(html).toContain('readonly array of `HtmlFragment` values');
});
