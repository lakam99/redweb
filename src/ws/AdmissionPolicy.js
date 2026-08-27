const ADMISSION_CONTEXT = Symbol('redweb.admissionContext');
const PLACEMENT_REDIRECT = Symbol('redweb.placementRedirect');

class AdmissionPolicy {
    constructor(options) {
        const config = typeof options === 'function' ? { authenticate: options } : options;
        if (!config || typeof config !== 'object' || Array.isArray(config)) {
            throw new TypeError('`admission` must be a function or an object.');
        }
        const { authenticate, origins, place, timeoutMs = 5000 } = config;
        if (authenticate !== undefined && typeof authenticate !== 'function') {
            throw new TypeError('`admission.authenticate` must be a function.');
        }
        if (!(Array.isArray(origins) || typeof origins === 'function' || origins === undefined)) {
            throw new TypeError('`admission.origins` must be an array or a function.');
        }
        if (place !== undefined && typeof place !== 'function') {
            throw new TypeError('`admission.place` must be a function.');
        }
        if (Array.isArray(origins) && origins.some(origin => typeof origin !== 'string' || !origin)) {
            throw new TypeError('Every `admission.origins` entry must be a non-empty string.');
        }
        if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
            throw new TypeError('`admission.timeoutMs` must be a positive integer.');
        }
        if (!authenticate && !origins && !place) {
            throw new TypeError('`admission` requires `authenticate`, `origins`, or `place`.');
        }
        this.authenticate = authenticate;
        this.origins = origins;
        this.place = place;
        this.timeoutMs = timeoutMs;
    }

    async authorize(request, rawSocket, route) {
        const controller = new AbortController();
        const onClose = () => controller.abort();
        rawSocket.once('close', onClose);
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        timer.unref();
        try {
            const cancelled = new Promise((_, reject) => {
                controller.signal.addEventListener('abort', () => reject(new Error('Admission cancelled.')), { once: true });
            });
            const result = await Promise.race([
                this.evaluate(request, route, controller.signal),
                cancelled,
            ]);
            if (result === false || rawSocket.destroyed || controller.signal.aborted) return false;
            if (result.redirect) {
                request[PLACEMENT_REDIRECT] = result.redirect;
                return false;
            }
            request[ADMISSION_CONTEXT] = { principal: result.principal };
            return true;
        } catch {
            return false;
        } finally {
            clearTimeout(timer);
            rawSocket.off?.('close', onClose);
        }
    }

    isSafeRedirect(value) {
        if (!value || value.length > 2048 || /[\r\n]/.test(value)) return false;
        try {
            return ['http:', 'https:', 'ws:', 'wss:'].includes(new URL(value).protocol);
        } catch {
            return false;
        }
    }

    async evaluate(request, route, signal) {
        if (!await this.acceptsOrigin(request)) return false;
        const context = {
            signal,
            networkIdentity: route.resolveRemoteAddress(request),
            route,
        };
        const principal = this.authenticate ? await this.authenticate(request, context) : undefined;
        if (principal === false) return false;
        if (!this.place) return { principal };
        const placement = await this.place(principal, request, context);
        if (placement === false) return false;
        if (typeof placement === 'string') {
            return this.isSafeRedirect(placement) ? { redirect: placement } : false;
        }
        return { principal };
    }

    async acceptsOrigin(request) {
        if (!this.origins) return true;
        const origin = request?.headers?.origin;
        if (typeof this.origins === 'function') {
            return Boolean(await this.origins(origin, request));
        }
        return typeof origin === 'string' && this.origins.includes(origin);
    }
}

module.exports = { AdmissionPolicy, ADMISSION_CONTEXT, PLACEMENT_REDIRECT };
