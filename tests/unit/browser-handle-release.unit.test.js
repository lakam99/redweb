'use strict';

const { releaseBrowserHandles } = require('../../scripts/lib/releaseBrowserHandles');

test.each(['success', 'stderr', 'unref', 'both', 'missing-browser', 'missing-child', 'missing-stderr'])
('browser handle release attempts independent cleanup: %s', mode => {
    const events = [], failures = [];
    const child = {
        stderr: { destroy() { events.push('stderr'); if (['stderr', 'both'].includes(mode)) throw new Error('stderr'); } },
        unref() { events.push('unref'); if (['unref', 'both'].includes(mode)) throw new Error('unref'); },
    };
    if (mode === 'missing-stderr') delete child.stderr;
    const browser = mode === 'missing-browser' ? undefined : mode === 'missing-child' ? {} : { child };
    releaseBrowserHandles(browser, error => failures.push(error.message));
    expect(events).toEqual(['missing-browser', 'missing-child'].includes(mode) ? []
        : mode === 'missing-stderr' ? ['unref'] : ['stderr', 'unref']);
    expect(failures).toEqual(mode === 'both' ? ['stderr', 'unref'] : ['stderr', 'unref'].includes(mode) ? [mode] : []);
});
