'use strict';

/** Release parent handles after failed shutdown without claiming the child exited. */
function releaseBrowserHandles(browser, recordFailure) {
    for (const release of [() => browser?.child?.stderr?.destroy(), () => browser?.child?.unref()]) {
        try { release(); } catch (error) { recordFailure(error); }
    }
}

module.exports = { releaseBrowserHandles };
