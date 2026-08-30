import type { Server } from 'node:http';

interface Application { server: Server; shutdown(): Promise<void>; }

/** Entry-point policy only: importing a recipe never installs process handlers. */
export function runApp<T extends Application>(createApp: () => T, shutdownTimeoutMs = 5000): T | undefined {
    if (!Number.isInteger(shutdownTimeoutMs) || shutdownTimeoutMs < 1 || shutdownTimeoutMs > 2147483647) {
        throw new RangeError('Application shutdown timeout must be a positive timer-safe integer.');
    }
    const fail = (message: string) => {
        console.error(message);
        if (Number(process.exitCode ?? 0) === 0) process.exitCode = 1;
    };
    let app: T;
    try { app = createApp(); }
    catch { fail('Application startup failed.'); return undefined; }

    let closing: Promise<void> | undefined;
    const stop = () => {
        if (!closing) {
            let failed = false;
            const deadline = setTimeout(() => {
                fail('Application cleanup exceeded its deadline; terminating the process.');
                process.exit();
            }, shutdownTimeoutMs);
            closing = Promise.resolve().then(() => app.shutdown()).catch(() => {
                failed = true;
                fail('Application cleanup failed.');
            }).finally(() => {
                // Failed cleanup may leave live handles. Permit natural exit if none
                // remain, but still force a bounded exit when resources were leaked.
                if (failed) { deadline.unref(); return; }
                clearTimeout(deadline);
                process.off('SIGINT', stop);
                process.off('SIGTERM', stop);
                app.server.off('error', onError);
                app.server.off('close', stop);
            });
        }
        return closing;
    };
    const onError = () => { fail('Application listener failed.'); void stop(); };
    // Persistent handlers keep repeated signals from bypassing active cleanup.
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    app.server.on('error', onError);
    // Native close can precede database/worker cleanup: it starts, never ends, shutdown.
    app.server.once('close', stop);
    return app;
}
