'use strict';

const { PageManager } = require('../../src/htmx/PageManager');
const LivePage = require('../../src/htmx/LivePage');
const { page } = require('../..');

test('a zero shutdown budget reports render and disposal timeouts without waiting for application hooks', async () => {
    let entered, releaseLoading, releaseDisposal, disposalCalls = 0;
    const ready = new Promise(resolve => { entered = resolve; });
    const loading = new Promise(resolve => { releaseLoading = resolve; });
    const disposing = new Promise(resolve => { releaseDisposal = resolve; });
    class PendingPage extends LivePage {
        loading() { entered(); return loading; }
        disposed() { disposalCalls += 1; return disposing; }
        render() { throw new Error('Cancelled loading must not render'); }
    }
    page('/')(PendingPage);
    const manager = new PageManager({ pages: [PendingPage], shutdownTimeoutMs: 0 });
    const rendering = manager.render(manager.records.get('/'), {}).catch(error => error);
    try {
        await ready;
        expect(manager.rendering).toBe(1);
        expect(manager.renderPages.size).toBe(1);
        const failure = await manager.shutdown().catch(error => error);
        expect(failure).toBeInstanceOf(AggregateError);
        expect(failure.code).toBe('LIVE_HTML_SHUTDOWN_TIMEOUT');
        expect(failure.errors.map(error => error.message)).toEqual([
            'Live HTML render cleanup exceeded shutdownTimeoutMs.',
            'Live HTML page disposal exceeded shutdownTimeoutMs.',
        ]);
        expect((await rendering).message).toContain('shutting down');
        expect(disposalCalls).toBe(1);
        expect(manager.rendering).toBe(0);
        expect(manager.renderPages.size).toBe(0);
        expect(manager.pending.size).toBe(0);
        expect(manager.lifetimes.size).toBe(0);
    } finally {
        releaseLoading();
        releaseDisposal();
        await rendering;
    }
});
