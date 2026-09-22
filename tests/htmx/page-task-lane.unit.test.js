const PageTaskLane = require('../../src/htmx/PageTaskLane');

describe('PageTaskLane', () => {
    test('serializes work, bounds pending tasks, and rejects cancelled waiters', async () => {
        expect(() => new PageTaskLane().enqueue(null)).toThrow('functions');
        const lane = new PageTaskLane(2);
        let release;
        const first = lane.enqueue(() => new Promise(resolve => { release = resolve; }));
        const second = lane.enqueue(() => 'second');
        expect(lane.enqueue(() => 'overflow')).toBeNull();
        release('first');
        await expect(first).resolves.toBe('first');
        await expect(second).resolves.toBe('second');

        let pending;
        const running = lane.enqueue(() => new Promise(resolve => { pending = resolve; }));
        const waiting = lane.enqueue(() => 'never');
        lane.close(new Error('cancelled'));
        await expect(waiting).rejects.toThrow('cancelled');
        pending('done');
        await expect(running).resolves.toBe('done');
        expect(lane.enqueue(() => 'closed')).toBeNull();
    });
});
