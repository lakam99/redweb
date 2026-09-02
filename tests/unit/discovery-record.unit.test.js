'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const directory = path.resolve(__dirname, '../../evaluations/2026-08-30-02');
const read = name => fs.readFileSync(path.join(directory, name), 'utf8').replace(/\r\n/g, '\n');
const hash = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

describe('frozen category-first discovery evidence', () => {
    test('preserves the exact unnominated prompt and submitted report', () => {
        const result = JSON.parse(read('result.json'));
        const prompt = read('discovery-prompt.txt');
        const report = read('DISCOVERY.md');
        expect(hash(prompt)).toBe(result.promptSha256LfUtf8);
        expect(hash(report)).toBe(result.reportSha256LfUtf8);
        expect(Buffer.byteLength(report, 'utf8')).toBe(result.reportBytesLfUtf8);
        expect(prompt).not.toMatch(/\bredweb\b/i);
        expect(prompt).toContain('Start with at least three package-agnostic category/task searches.');
        expect(report.toLowerCase()).toContain(`${result.selectedPackage} ${result.selectedVersion}`);
        expect(report).toContain(result.reportedStartedAt);
        expect(report).toContain(result.reportedEndedAt);
        expect(Date.parse(result.reportedEndedAt)).toBeGreaterThan(Date.parse(result.reportedStartedAt));
    });

    test('does not relabel discovery as blinded or independently passing implementation', () => {
        const result = JSON.parse(read('result.json'));
        expect(result).toMatchObject({
            schemaVersion: 1, kind: 'category-first-discovery', conversationHistory: 'none',
            resolvedModel: null, resolvedReasoningEffort: null, independentDurationMs: null,
            completeToolTranscriptCaptured: false, searchSequenceIndependentlyVerified: false,
            workspaceNameExposure: true, implementationAttempted: false,
            independentApplicationAcceptance: null, selectionRepairRounds: 0,
        });
        expect(read('ASSESSMENT.md')).toContain('plausible suitability');
        expect(read('ASSESSMENT.md')).toContain('not fully blinded');
    });
});
