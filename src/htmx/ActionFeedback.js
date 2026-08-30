'use strict';

/** Browser-safe request state. DOM and transport stay with their existing owners. */
class ActionFeedback {
    constructor(changed, report) {
        this.records = new WeakMap();
        this.pending = 0;
        this.changed = changed;
        this.report = report;
    }

    get(source) { return this.records.get(source); }

    async run(source, request) {
        if (this.get(source)?.status === 'pending') return false;
        const record = { status: 'pending', message: 'Working…' };
        this.records.set(source, record);
        if (this.pending >= 32) {
            this.fail(source, record, { code: 'ACTION_CAPACITY' });
            return false;
        }
        this.pending += 1;
        try {
            this.changed(source, record);
            await request();
            record.status = 'success';
            record.message = 'Done.';
            this.changed(source, record);
            return true;
        } catch (error) {
            this.fail(source, record, error);
            return false;
        } finally {
            this.pending -= 1;
        }
    }

    fail(source, record, error) {
        record.status = 'error';
        const messages = {
            ACTION_INVALID_INPUT: 'Check the form values and try again.',
            ACTION_VALIDATION_TIMEOUT: 'Input validation timed out. The action was not run.',
            ACTION_CANCELLED: 'Input validation was cancelled. The action was not run.',
            ACTION_OFFLINE: 'Not connected. The action was not sent.',
            ACTION_CAPACITY: 'Too many pending actions. Wait before trying again. This action was not sent.',
        };
        record.message = Object.hasOwn(messages, error?.code) ? messages[error.code]
            : 'The action could not be confirmed. Check before trying again.';
        this.changed(source, record);
        this.report(error);
    }
}

module.exports = ActionFeedback;
