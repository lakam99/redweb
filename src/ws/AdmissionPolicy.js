const ADMISSION_CONTEXT = Symbol('redweb.admissionContext');

class AdmissionPolicy {
    constructor(options) {
        const config = typeof options === 'function' ? { authenticate: options } : options;
        if (!config || typeof config !== 'object' || Array.isArray(config)) {
            throw new TypeError('`admission` must be a function or an object.');
        }
        const { authenticate, origins, timeoutMs = 5000 } = config;
        if (authenticate !== undefined && typeof authenticate !== 'function') {
            throw new TypeError('`admission.authenticate` must be a function.');
        }
        if (!(Array.isArray(origins) || typeof origins === 'function' || origins === undefined)) {
            throw new TypeError('`admission.origins` must be an array or a function.');
        }
        if (Array.isArray(origins) && origins.some(origin => typeof origin !== 'string' || !origin)) {
            throw new TypeError('Every `admission.origins` entry must be a non-empty string.');
        }
        if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
            throw new TypeError('`admission.timeoutMs` must be a positive integer.');
        }
        if (!authenticate && !origins) {
            throw new TypeError('`admission` requires `authenticate` or `origins`.');
        }
        this.authenticate = authenticate;
        this.origins = origins;
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
            const principal = await Promise.race([
                this.evaluate(request, route, controller.signal),
                cancelled,
            ]);
            if (principal === false || rawSocket.destroyed || controller.signal.aborted) return false;
            request[ADMISSION_CONTEXT] = { principal };
            return true;
        } catch {
            return false;
        } finally {
            clearTimeout(timer);
            rawSocket.off?.('close', onClose);
        }
    }

    async evaluate(request, route, signal) {
        if (!await this.acceptsOrigin(request)) return false;
        if (!this.authenticate) return undefined;
        return this.authenticate(request, {
            signal,
            networkIdentity: route.resolveRemoteAddress(request),
            route,
        });
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

module.exports = { AdmissionPolicy, ADMISSION_CONTEXT };
