const { performance } = require('perf_hooks');
const SocketService = require('./SocketService');

class FixedStepService extends SocketService {
    constructor(name, tickRateMs, maxCatchUpTicks = 5) {
        super(name, tickRateMs);
        if (!Number.isInteger(tickRateMs) || tickRateMs < 1) {
            throw new TypeError('`tickRateMs` must be a positive integer.');
        }
        if (!Number.isInteger(maxCatchUpTicks) || maxCatchUpTicks < 1) {
            throw new TypeError('`maxCatchUpTicks` must be a positive integer.');
        }
        this.maxCatchUpTicks = maxCatchUpTicks;
        this.tick = 0;
        this.accumulatorMs = 0;
        this._runningPromise = null;
    }

    now() {
        return performance.now();
    }

    onInit(route) {
        this.route = route;
        this.lastTime = this.now();
        this._tickHandle = setInterval(() => this.pulse(), this.tickRateMs);
        this._tickHandle.unref?.();
    }

    pulse() {
        if (this._runningPromise) return this._runningPromise;
        const now = this.now();
        this.accumulatorMs += Math.max(0, now - this.lastTime);
        this.lastTime = now;
        const due = Math.min(this.maxCatchUpTicks, Math.floor(this.accumulatorMs / this.tickRateMs));
        if (!due) return Promise.resolve();
        this.accumulatorMs -= due * this.tickRateMs;
        this._runningPromise = this.runTicks(due).finally(() => { this._runningPromise = null; });
        return this._runningPromise;
    }

    async runTicks(count) {
        for (let index = 0; index < count; index += 1) {
            this.tick += 1;
            try {
                await this.onTick?.(this.tickRateMs, this.tick);
            } catch (error) {
                this.route?.logger?.error?.('Fixed-step service tick failed:', error);
            }
        }
    }

    async onShutdown() {
        if (this._tickHandle) clearInterval(this._tickHandle);
        this._tickHandle = null;
        await this._runningPromise;
    }
}

module.exports = FixedStepService;
