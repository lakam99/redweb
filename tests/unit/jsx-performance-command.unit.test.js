'use strict';

// Explicit measurement/output boundary units. The separate native CLI tests
// use the real renderer, clock and GC without replacing APIs.
const mutations = {
    'missing-row': output => output.replace(/<li .*?<\/li>/, ''),
    'unescaped-label': output => output.replace('&lt;safe&gt;', '<safe>'),
    'missing-label': output => output.replace('<strong>&lt;safe&gt;</strong>', '<strong></strong>'),
    'duplicate-index': output => output.replace('data-index="1"', 'data-index="0"'),
    'wrong-child': output => output.replace('</strong>: 0</li>', '</strong>: 999</li>'),
    'missing-closing-tag': output => output.replace('</ul>', ''),
    'extra-markup': output => output + '<p>unexpected</p>',
};

test.each(['pass', 'negative-growth', 'exact-limits', 'missing-gc', 'slow-render', 'retained-heap', ...Object.keys(mutations)])
('JSX performance command checks %s and retains measurement boundaries', mode => {
    const originalGc = global.gc, events = [];
    const runtime = jest.requireActual('../../jsx-runtime');
    const gc = jest.fn(() => events.push('gc'));
    const elapsed = mode === 'slow-render' ? 5001 : mode === 'exact-limits' ? 5000 : 1;
    const growth = mode === 'retained-heap' ? 32 * 1024 * 1024 + 1 : mode === 'exact-limits' ? 32 * 1024 * 1024 : mode === 'negative-growth' ? -1 : 1;
    let memoryReads = 0, clockReads = 0;
    const memory = jest.spyOn(process, 'memoryUsage').mockImplementation(() => {
        events.push('memory'); return { heapUsed: 100 + (memoryReads++ ? growth : 0) };
    });
    const clock = jest.spyOn(process.hrtime, 'bigint').mockImplementation(() => {
        events.push('clock'); return BigInt(clockReads++ ? elapsed * 1e6 : 0);
    });
    const log = jest.spyOn(console, 'log').mockImplementation(() => events.push('success'));
    try {
        global.gc = mode === 'missing-gc' ? undefined : gc;
        const load = () => jest.isolateModules(() => {
            jest.doMock('../../jsx-runtime', () => ({ ...runtime, jsx(type, properties) {
                const node = runtime.jsx(type, properties);
                if (type !== 'ul') return node;
                return { toString() {
                    events.push('render');
                    const output = node.toString();
                    return mutations[mode] ? mutations[mode](output) : output;
                } };
            } }));
            require('../../scripts/verify-jsx-performance');
        });
        if (['pass', 'negative-growth', 'exact-limits'].includes(mode)) {
            load();
            expect(events).toEqual(['gc', 'memory', 'clock', 'render', 'clock', 'gc', 'memory', 'success']);
            expect(log).toHaveBeenCalledWith(expect.stringContaining('10000 component rows'));
            if (mode === 'negative-growth') expect(log).toHaveBeenCalledWith(expect.stringContaining('0.0 MiB retained'));
        } else {
            const message = mode === 'missing-gc' ? '--expose-gc' : mode === 'slow-render' ? 'took 5001.0ms' :
                mode === 'retained-heap' ? 'retained 32.0 MiB' : 'incorrect markup';
            expect(load).toThrow(message);
            expect(log).not.toHaveBeenCalled();
        }
    } finally {
        global.gc = originalGc;
        memory.mockRestore(); clock.mockRestore(); log.mockRestore();
        jest.dontMock('../../jsx-runtime');
    }
});
