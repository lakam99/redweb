const ActionFeedback = require('../../src/htmx/ActionFeedback');

describe('action feedback request state', () => {
    test('suppresses duplicates by source identity, allows siblings, and permits retry after completion', async () => {
        const updates = [], errors = [];
        const feedback = new ActionFeedback((source, record) => updates.push([source, record.status, record.message]), error => errors.push(error));
        const first = {}, second = {};
        let finish, calls = 0;
        const pending = feedback.run(first, () => { calls += 1; return new Promise(resolve => { finish = resolve; }); });
        expect(feedback.pending).toBe(1);
        expect(feedback.get(first).status).toBe('pending');
        expect(await feedback.run(first, () => { calls += 1; })).toBe(false);
        expect(await feedback.run(second, () => { calls += 1; })).toBe(true);
        finish();
        expect(await pending).toBe(true);
        expect(feedback.pending).toBe(0);
        expect(await feedback.run(first, () => { calls += 1; })).toBe(true);
        expect(calls).toBe(3);
        expect(errors).toEqual([]);
        expect(updates.map(update => update[1])).toEqual(['pending', 'pending', 'success', 'success', 'pending', 'success']);
    });

    test.each(['ACTION_INVALID_INPUT', 'ACTION_VALIDATION_TIMEOUT', 'ACTION_CANCELLED', 'ACCESS_DENIED', 'ACCESS_TIMEOUT', 'ACCESS_CANCELLED', 'ACTION_OFFLINE', '__proto__', 'toString', undefined])('sanitizes %p and allows correction after failure', async code => {
        const updates = [], errors = [];
        const feedback = new ActionFeedback((_source, record) => updates.push(record.message), error => errors.push(error));
        const source = {};
        const failure = code ? { code, message: '<script>secret</script>' } : undefined;
        expect(await feedback.run(source, () => { throw failure; })).toBe(false);
        expect(feedback.get(source).status).toBe('error');
        expect(typeof feedback.get(source).message).toBe('string');
        expect(feedback.get(source).message).not.toContain('secret');
        expect(errors).toEqual([failure]);
        expect(feedback.pending).toBe(0);
        expect(await feedback.run(source, () => Promise.resolve())).toBe(true);
        expect(updates.at(-1)).toBe('Done.');
    });

    test('bounds connected requests independently of the offline queue and releases capacity', async () => {
        const errors = [], finish = [];
        const feedback = new ActionFeedback(() => {}, error => errors.push(error));
        const requests = Array.from({ length: 32 }, () => feedback.run({}, () => new Promise(resolve => finish.push(resolve))));
        const extra = {};
        expect(await feedback.run(extra, () => { throw new Error('must not run'); })).toBe(false);
        expect(feedback.pending).toBe(32);
        expect(feedback.get(extra).message).toContain('not sent');
        expect(errors).toEqual([{ code: 'ACTION_CAPACITY' }]);
        finish.forEach(resolve => resolve());
        expect(await Promise.all(requests)).toEqual(Array(32).fill(true));
        expect(feedback.pending).toBe(0);
        expect(await feedback.run(extra, () => {})).toBe(true);
    });
});
