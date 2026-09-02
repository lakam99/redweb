'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const WebSocket = require('ws');
const { request, waitForOpen, waitForListening, waitForCondition, closeWebSocket } = require('../helpers/network');

const packageRoot = path.resolve(__dirname, '../..');

describe('doctor source repair workflow without executing application code', () => {
    let root;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-doctor-source-'));
        fs.mkdirSync(path.join(root, 'node_modules'));
        fs.symlinkSync(packageRoot, path.join(root, 'node_modules', 'redweb'), 'junction');
        fs.symlinkSync(path.dirname(require.resolve('typescript/package.json')), path.join(root, 'node_modules', 'typescript'), 'junction');
        fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ extends: 'redweb/tsconfig.json', include: ['*.ts'] }));
    });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    function doctor(directory = root, json = true) {
        const result = spawnSync(process.execPath, [path.join(packageRoot, 'bin/redweb.js'), 'doctor', ...(json ? ['--json'] : [])], {
            cwd: directory, encoding: 'utf8', timeout: 10000, windowsHide: true,
        });
        expect(result.stderr).toBe('');
        return { status: result.status, report: json ? JSON.parse(result.stdout) : null, stdout: result.stdout };
    }

    test('a literal action typo is repaired through the CLI and the compiled fix works over real HTTP/WebSockets', async () => {
        const source = `
            import { page, action, state, defineApp } from 'redweb';
            @page('/') class Home {
                @state() count = 0;
                @action() save() { this.count++; }
                render() { return <main><output>{this.count}</output><button rw-click="saev">Save</button></main>; }
            }
            export const app = defineApp({ pages: [Home], port: 0, bind: '127.0.0.1', logger: null, signals: false });
        `;
        fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ extends: 'redweb/tsconfig.json', compilerOptions: { outDir: 'dist' }, include: ['*.tsx'] }));
        fs.writeFileSync(path.join(root, 'app.tsx'), source);
        const failed = doctor();
        expect(failed.status).toBe(1);
        expect(failed.report.checks).toContain('source-actions');
        expect(failed.report.issues).toEqual([expect.objectContaining({ code: 'ACTION_NOT_EXPOSED', file: 'app.tsx', message: expect.stringContaining('saev') })]);
        expect(fs.existsSync(path.join(root, 'dist'))).toBe(false);
        fs.writeFileSync(path.join(root, 'app.tsx'), source.replace('rw-click="saev"', 'rw-click="save"'));
        expect(doctor().report.issues).toEqual([]);
        const compiled = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', root], { encoding: 'utf8', windowsHide: true });
        expect(compiled.stdout + compiled.stderr).toBe('');
        expect(compiled.status).toBe(0);
        const server = require(path.join(root, 'dist/app.js')).app;
        let socket;
        try {
            await server.run();
            const port = server.server.address().port;
            const response = await request({ port });
            expect(response.status).toBe(200);
            const config = JSON.parse(response.body.match(/id="__redweb_page">([^<]+)/)[1]);
            const messages = [];
            socket = new WebSocket(`ws://127.0.0.1:${port}${config.socketPath}?pageId=${config.pageId}&redwebVersion=${config.version}`, { headers: { Origin: `http://127.0.0.1:${port}` } });
            socket.on('message', data => messages.push(JSON.parse(data.toString())));
            await waitForOpen(socket);
            socket.send(JSON.stringify({ v: config.version, type: 'redweb:html', payload: { kind: 'action', name: 'save', args: [] } }));
            await waitForCondition(() => messages.some(message => message.type === 'redweb:patch' && message.payload.patches.some(patch => patch.html.includes('<output>1</output>'))), 'repaired action patch');
        } finally { await closeWebSocket(socket); await server.shutdown(); }
    }, 15000);

    test('locates missing CSS and conflicting pages, then passes after real file repairs', () => {
        const source = `
            import { page, start } from 'redweb';
            import { writeFileSync } from 'node:fs';
            writeFileSync('must-not-exist.txt', 'Application code ran');
            @page('/', { css: 'app.css' }) class Home {}
            @page('/') class About {}
            start([Home, About]);
        `;
        fs.writeFileSync(path.join(root, 'app.ts'), source);
        const failed = doctor();
        expect(failed.status).toBe(1);
        expect(failed.report.issues.map(issue => issue.code).sort()).toEqual(['ASSET_UNAVAILABLE', 'DUPLICATE_ROUTE']);
        expect(failed.report.checks).toEqual(expect.arrayContaining(['source-assets', 'source-routes', 'source-handlers']));
        expect(failed.report.issues.every(issue => issue.file === 'app.ts' && issue.line && issue.column && issue.suggestion)).toBe(true);
        expect(fs.existsSync(path.join(root, 'must-not-exist.txt'))).toBe(false);
        expect(fs.readFileSync(path.join(root, 'app.ts'), 'utf8')).toBe(source);
        expect(doctor(root, false).stdout).toMatch(/DUPLICATE_ROUTE \(app\.ts:\d+:\d+\)/);

        fs.writeFileSync(path.join(root, 'app.css'), 'body { color: red; }');
        fs.writeFileSync(path.join(root, 'app.ts'), source.replace("@page('/') class About", "@page('/about') class About"));
        const repaired = doctor();
        expect(repaired.status).toBe(0);
        expect(repaired.report.issues).toEqual([]);
        expect(repaired.report.source.files).toBe(1);
        expect(fs.existsSync(path.join(root, 'must-not-exist.txt'))).toBe(false);
        expect(fs.existsSync(path.join(root, 'app.js'))).toBe(false);
    });

    test('reports duplicate imported handler types while leaving unrelated APIs and user files alone', () => {
        fs.writeFileSync(path.join(root, 'handlers.ts'), `
            import { BaseHandler } from 'redweb';
            export class Join extends BaseHandler { constructor() { super('join'); } }
            export class OtherJoin extends BaseHandler { constructor() { super('join'); } }
            throw new Error('Must not load handlers');
        `);
        fs.writeFileSync(path.join(root, 'app.ts'), `
            import { SocketRoute, SocketServer } from 'redweb';
            import { Join, OtherJoin } from './handlers';
            class Match extends SocketRoute { constructor() { super({ path:'/match', handlers:[Join, OtherJoin] }); } }
            new SocketServer({ routes:[Match] });
            const custom = { start() { throw new Error('Not Redweb'); } }; custom.start();
        `);
        const result = doctor();
        expect(result.status).toBe(1);
        expect(result.report.issues.map(issue => issue.code)).toEqual(['DUPLICATE_HANDLER']);
    });

    test('dynamic registrations produce actionable warnings, not false success claims or execution', () => {
        fs.writeFileSync(path.join(root, 'app.ts'), `
            import { start } from 'redweb';
            function choosePages() { throw new Error('This cannot execute'); }
            start(choosePages());
        `);
        const result = doctor();
        expect(result.status).toBe(0);
        expect(result.report.issues[0]).toMatchObject({ code: 'SOURCE_UNRESOLVED', severity: 'warning', file: 'app.ts' });
        expect(result.report.source.unresolved).toBe(1);
    });

    test('an actual older installed TypeScript gets an actionable diagnostic instead of a crash', () => {
        const legacy = path.join(root, 'legacy');
        fs.mkdirSync(path.join(legacy, 'node_modules'), { recursive: true });
        const fixture = path.dirname(require.resolve('redweb-legacy-compiler-fixture/package.json'));
        const compiler = require.resolve('typescript/package.json', { paths: [fixture] });
        fs.symlinkSync(path.dirname(compiler), path.join(legacy, 'node_modules', 'typescript'), 'junction');
        fs.writeFileSync(path.join(legacy, 'tsconfig.json'), '{"files":["app.ts"]}');
        fs.writeFileSync(path.join(legacy, 'app.ts'), 'throw new Error("Cannot execute app code");');
        const result = doctor(legacy);
        expect(result.status).toBe(1);
        expect(result.report.issues.map(issue => issue.code)).toEqual(['TYPESCRIPT_UNSUPPORTED']);
        expect(result.report.issues[0].message).toContain('4.9.5');
        expect(result.report.source).toBeNull();
    });
});
