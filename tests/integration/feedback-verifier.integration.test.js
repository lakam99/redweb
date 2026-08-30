'use strict';

const { verifyActionFeedback } = require('../../scripts/lib/verify-action-feedback');
const { page } = require('../..');

describe('action-feedback verification resource failures', () => {
    test('retains the primary failure when a real page disposal also rejects', async () => {
        const primary = new Error('verification setup failed');
        const cleanup = new Error('application disposal failed');
        class RejectingPage {
            render() { return '<p>cleanup fixture</p>'; }
            disposed() { throw cleanup; }
        }
        page('/cleanup-fixture', { shared: true })(RejectingPage);
        let application, failure;
        try {
            await verifyActionFeedback({
                onServer(server) {
                    application = server;
                    // This is an actual application lifecycle hook, not a replacement
                    // server, transport, shutdown method or browser implementation.
                    server.manager.register(RejectingPage);
                    throw primary;
                },
            });
        } catch (error) { failure = error; }
        expect(failure).toBeInstanceOf(AggregateError);
        expect(failure.cause).toBe(primary);
        expect(failure.errors[0]).toBe(primary);
        const leafErrors = error => error instanceof AggregateError ? error.errors.flatMap(leafErrors) : [error];
        expect(leafErrors(failure)).toContain(cleanup);
        expect(application.server.listening).toBe(false);
        expect(application.manager.sharedPages.size).toBe(0);
    });

    test('a non-Error setup failure remains a failure after actual server cleanup', async () => {
        let application, failure;
        try {
            await verifyActionFeedback({ onServer(server) { application = server; throw null; } });
        } catch (error) { failure = error; }
        expect(failure).toBeInstanceOf(Error);
        expect(failure.cause).toBeNull();
        expect(application.server.listening).toBe(false);
        expect(application.manager.sharedPages.size).toBe(0);
    });
});
