'use strict';

const assert = require('node:assert/strict');

// Known static V8 reason labels only. Other reasons remain counted, without
// publishing arbitrary strings from a local code log. This is not exhaustive.
const reasons = new Set(['weak objects', 'code dependencies', 'wrong map', 'wrong call target',
    'wrong feedback cell', 'deprecated map', 'not a Smi', 'not a heap number', 'overflow',
    'Insufficient type feedback for call', 'Insufficient type feedback for construct',
    'Insufficient type feedback for generic named access', '(unknown)']);
const address = value => /^0x[\da-f]+$/i.test(value);
const integer = value => /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value));

/** Log-order address correlation, NOT a live-code/retained-memory registry.
 * Counts refer only to records present; verify --log-deopt in worker flags before
 * interpreting zero. Older client-code logs did not enable deoptimization logs.
 */
class DeoptimizationCensus {
    constructor() {
        this.code = new Map();
        this.events = [];
        this.moves = 0;
        this.unmatchedMoves = 0;
        this.lastTime = 0;
    }

    created(pointer, event) {
        this.lastTime = event.time;
        this.code.set(pointer.toLowerCase(), event);
    }

    move(fields) {
        assert(fields.length === 3 && address(fields[1]) && address(fields[2]), 'Invalid code move');
        const from = fields[1].toLowerCase(), to = fields[2].toLowerCase();
        const event = this.code.get(from);
        this.code.delete(from);
        // An unknown move must invalidate a stale destination association.
        if (event) this.code.set(to, event);
        else { this.code.delete(to); this.unmatchedMoves++; }
        this.moves++;
    }

    deopt(fields, afterCreation) {
        assert(fields.length === 9, 'Malformed deoptimization record');
        const [, time, size, pointer, inlining, offset, kind, , rawReason] = fields;
        assert(integer(time) && Number(time) >= this.lastTime && Number(time) >= 0, 'Invalid deoptimization timestamp');
        assert(integer(size) && Number(size) >= 0 && address(pointer), 'Invalid deoptimization code');
        assert(integer(inlining) && Number(inlining) >= -1 && integer(offset) && Number(offset) >= -1, 'Invalid deoptimization position');
        assert(['dependency-change', 'deopt-eager', 'deopt-lazy'].includes(kind), 'Unknown deoptimization kind');
        this.lastTime = Number(time);
        const code = this.code.get(pointer.toLowerCase());
        const matched = Boolean(code && ['MAGLEV', 'TURBOFAN'].includes(code.kind));
        const { source, name, line, column } = matched ? code : { source: 'other', name: 'unmatched' };
        this.events.push({ afterCreation, time: Number(time), kind,
            reason: reasons.has(rawReason) ? rawReason : 'unclassified', matched, source, name, line, column });
        // V8 logs InstructionStreamObjectSize here, not the creation event's
        // InstructionSize. Do not aggregate or equate those different sizes.
    }

    summary(warm, final) {
        const selected = this.events.filter(event => event.afterCreation >= warm && event.afterCreation < final);
        const groups = new Map();
        for (const { time, afterCreation, ...labels } of selected) {
            const key = JSON.stringify(labels);
            const group = groups.get(key) || { ...labels, events: 0, firstTimeUs: time, lastTimeUs: time };
            group.events++;
            group.lastTimeUs = time;
            groups.set(key, group);
        }
        return { totalEvents: this.events.length, intervalEvents: selected.length,
            beforeWarm: this.events.filter(event => event.afterCreation < warm).length,
            atOrAfterFinal: this.events.filter(event => event.afterCreation >= final).length,
            intervalUnmatched: selected.filter(event => !event.matched).length,
            intervalUnclassifiedReasons: selected.filter(event => event.reason === 'unclassified').length,
            codeMoves: this.moves, unmatchedCodeMoves: this.unmatchedMoves,
            rows: [...groups.values()].sort((a, b) => b.events - a.events || JSON.stringify(a).localeCompare(JSON.stringify(b))) };
    }
}

module.exports = { DeoptimizationCensus };
