'use strict';

const { main, withServers } = require('../../scripts/verify-live-html-package');
const { LivePage, LiveHtmlServer, page } = require('../..');
const { waitForListening, request } = require('../helpers/network');
const { projectNodeIssue } = require('../../src/cli/ProjectDoctor');
const { projectFiles } = require('../../src/cli/templates');
const manifest = JSON.parse(projectFiles(require('../../package.json').version, 'dashboard').find(file => file.path === 'package.json').content);
const packageTest = projectNodeIssue(process.versions.node, manifest.engines.node)?.severity === 'error' ? test.skip : test;

// The canonical gate installs the packed artifact in isolation, executes actual
// Chromium and source-free generated/documented applications, and removes its
// owned workspace. No compiler, process, browser, filesystem or transport mocks.
packageTest('the package coordinator verifies the actual isolated consumer and documented applications', async () => {
    await main();
}, 900000);

test.each(['partial-start', 'assertion'])('the package owner closes actual listeners after %s failure', async mode => {
    class NativePage extends LivePage { render() { return '<h1>Owned package fixture</h1>'; } }
    page('/', { live: false })(NativePage);
    const owner = {}, acquired = [], failures = [];
    const primary = new Error('deliberate acceptance failure');
    try {
        const result = await withServers(owner, async own => {
            for (let index = 0; index < 2; index++) {
                const server = own(new LiveHtmlServer({ pages: [NativePage], port: 0, bind: '127.0.0.1', logger: () => {} }));
                acquired.push(server);
                await waitForListening(server.server);
                const response = await request({ port: server.server.address().port });
                expect(response.body).toContain('Owned package fixture');
            }
            if (mode === 'partial-start') own(new LiveHtmlServer(null));
            else throw primary;
        }).catch(error => error);
        expect(acquired).toHaveLength(2);
        if (mode === 'assertion') expect(result).toBe(primary);
        else expect(result.message).toContain('options must be an object');
        // Verify before rescue: the production helper must have closed both.
        expect(acquired.map(server => server.server.listening)).toEqual([false, false]);
        expect(owner.cleanupFailure).toBeUndefined();
    } catch (error) { failures.push(error); }
    finally {
        for (const server of acquired) {
            try { await server.shutdown(); } catch (error) { failures.push(error); }
        }
    }
    if (failures.length) throw new AggregateError(failures, 'Native package ownership check failed');
});
