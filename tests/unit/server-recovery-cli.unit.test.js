'use strict';

// Unit-only boundary substitution covers exit propagation, not recovery or
// networking. Real workers/CLI rejection paths are tested by the integration
// suite; ordinary CI runs this exact entrypoint against real sockets.
test.each(['pass', 'budget-failure', 'error'])('server recovery CLI preserves %s outcome', async outcome => {
    const originalExitCode = process.exitCode;
    const error = new Error('unit-only coordinator failure');
    const main = jest.fn(() => outcome === 'error'
        ? Promise.reject(error) : Promise.resolve({ candidatePassed: outcome === 'pass' }));
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
        jest.isolateModules(() => {
            jest.doMock('../../scripts/lib/ServerRecoveryCandidate', () => ({ main }));
            require('../../scripts/verify-server-recovery');
        });
        // Flush both the success continuation and its chained catch.
        await Promise.resolve();
        await Promise.resolve();
        expect(main).toHaveBeenCalledWith(process.argv.slice(2));
        expect(process.exitCode).toBe(outcome === 'pass' ? 0 : 1);
        if (outcome === 'error') expect(stderr).toHaveBeenCalledWith(expect.stringContaining(error.message));
        else expect(stderr).not.toHaveBeenCalled();
    } finally {
        process.exitCode = originalExitCode;
        stderr.mockRestore();
        jest.dontMock('../../scripts/lib/ServerRecoveryCandidate');
    }
});
