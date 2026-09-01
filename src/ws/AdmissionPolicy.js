const ADMISSION_CONTEXT = Symbol('redweb.admissionContext');
const PLACEMENT_REDIRECT = Symbol('redweb.placementRedirect');
const ADMISSION_SETTLEMENT = Symbol('redweb.admissionSettlement');
const { BoundedOperation, OperationInterrupted } = require('../async/BoundedOperation');
const { RequestFailure, UPGRADE_REJECTION } = require('../access/RequestFailure');

class AdmissionPolicy {
    constructor(options) {
        const config = typeof options === 'function' ? { authenticate: options } : options;
        if (!config || typeof config !== 'object' || Array.isArray(config)) {
            throw new TypeError('`admission` must be a function or an object.');
        }
        const {
            authenticate,
            origins,
            place,
            timeoutMs = 5000,
            allowedPlacementOrigins,
            allowInsecurePlacement = false,
        } = config;
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
        if (typeof allowInsecurePlacement !== 'boolean') {
            throw new TypeError('`admission.allowInsecurePlacement` must be a boolean.');
        }
        if (allowedPlacementOrigins !== undefined && !Array.isArray(allowedPlacementOrigins)) {
            throw new TypeError('`admission.allowedPlacementOrigins` must be an array.');
        }
        this.allowedPlacementOrigins = allowedPlacementOrigins?.map(origin => this.validatePlacementOrigin(origin));
        if (this.allowedPlacementOrigins && new Set(this.allowedPlacementOrigins).size !== this.allowedPlacementOrigins.length) {
            throw new TypeError('`admission.allowedPlacementOrigins` entries must be unique.');
        }
        if (!authenticate && !origins && !place) {
            throw new TypeError('`admission` requires `authenticate`, `origins`, or `place`.');
        }
        this.authenticate = authenticate;
        this.origins = origins;
        this.place = place;
        this.timeoutMs = timeoutMs;
        this.boundary = new BoundedOperation(timeoutMs);
        this.allowInsecurePlacement = allowInsecurePlacement;
    }

    async authorize(request, rawSocket, route, externalSignal) {
        const controller = new AbortController();
        const onClose = () => controller.abort();
        rawSocket.once('close', onClose);
        if (rawSocket.destroyed || externalSignal?.aborted) controller.abort();
        else externalSignal?.addEventListener('abort', onClose, { once: true });
        try {
            const result = await this.boundary.run((signal, checkpoint) => {
                const evaluation = this.evaluate(request, route, signal, checkpoint);
                request[ADMISSION_SETTLEMENT] = evaluation.then(() => undefined, () => undefined);
                return evaluation;
            }, controller.signal);
            if (rawSocket.destroyed || controller.signal.aborted) throw new RequestFailure('ADMISSION_CANCELLED');
            if (result.redirect) {
                request[PLACEMENT_REDIRECT] = result.redirect;
                return false;
            }
            request[ADMISSION_CONTEXT] = { principal: result.principal };
            return true;
        } catch (error) {
            request[UPGRADE_REJECTION] = (error instanceof OperationInterrupted
                ? new RequestFailure(error.reason === 'timeout' ? 'ADMISSION_TIMEOUT' : 'ADMISSION_CANCELLED')
                : RequestFailure.from(error)).rejection;
            return false;
        } finally {
            rawSocket.off?.('close', onClose);
            externalSignal?.removeEventListener?.('abort', onClose);
        }
    }

    validatePlacementOrigin(origin) {
        if (typeof origin !== 'string' || !origin) {
            throw new TypeError('Placement origins must be non-empty strings.');
        }
        let parsed;
        try {
            parsed = new URL(origin);
        } catch {
            throw new TypeError('Placement origins must be valid ws or wss origins.');
        }
        if (!['ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
            throw new TypeError('Placement origins must be ws or wss origins without credentials, paths, queries, or fragments.');
        }
        return parsed.origin;
    }

    isSafeRedirect(value) {
        if (!value || value.length > 2048 || /[\r\n]/.test(value)) return false;
        try {
            const parsed = new URL(value);
            if (!['ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) return false;
            if (parsed.protocol === 'ws:' && !this.allowInsecurePlacement) return false;
            return !this.allowedPlacementOrigins || this.allowedPlacementOrigins.includes(parsed.origin);
        } catch {
            return false;
        }
    }

    async evaluate(request, route, signal, checkpoint) {
        if (!await this.acceptsOrigin(request)) throw new RequestFailure('ORIGIN_DENIED');
        checkpoint();
        const context = {
            signal,
            networkIdentity: route.resolveRemoteAddress(request),
            route,
        };
        const principal = this.authenticate ? await this.authenticate(request, context) : undefined;
        if (principal === false) throw new RequestFailure('AUTHENTICATION_REQUIRED');
        checkpoint();
        if (!this.place) return { principal };
        const placement = await this.place(principal, request, context);
        if (placement === false) throw new RequestFailure('PLACEMENT_DENIED');
        if (typeof placement === 'string') {
            if (!this.isSafeRedirect(placement)) throw new RequestFailure('PLACEMENT_INVALID');
            return { redirect: placement };
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

module.exports = { AdmissionPolicy, ADMISSION_CONTEXT, PLACEMENT_REDIRECT, ADMISSION_SETTLEMENT };
