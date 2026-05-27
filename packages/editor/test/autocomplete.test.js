import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { aretinoComplete, completionSections } from '../src/autocomplete.js';
import { aretino } from '../src/highlight.js';

function contextFor(markedSource, explicit = true) {
    const pos = markedSource.indexOf('|');
    const doc = markedSource.slice(0, pos) + markedSource.slice(pos + 1);
    const state = EditorState.create({ doc, extensions: [aretino()] });
    return new CompletionContext(state, pos, explicit);
}

function complete(markedSource, explicit = true) {
    return aretinoComplete(contextFor(markedSource, explicit));
}

function labels(result) {
    return result?.options.map(opt => opt.label) ?? [];
}

function option(result, label) {
    return result.options.find(opt => opt.label === label);
}

describe('aretinoComplete', () => {
    it('offers all logical line starters at an explicit empty line', () => {
        const result = complete('|');

        expect(result.from).toBe(0);
        expect(labels(result)).toEqual(expect.arrayContaining([
            '%title:',
            '%',
            '(g2)',
            '(K:)',
            'w:',
            'W:',
            'n:',
        ]));
        for (const pitch of 'abcdefgABCDEFG') {
            expect(labels(result)).not.toContain(pitch);
        }
    });

    it('does not offer header keys after the body has started', () => {
        const result = complete('(g2) g\n%|');

        expect(labels(result)).toEqual(['%', '%[']);
        expect(labels(result)).not.toContain('%title:');
    });

    it('completes header option names before generic line-start headers', () => {
        const result = complete('%option:|');

        expect(result.from).toBe('%option:'.length);
        expect(labels(result)).toEqual(expect.arrayContaining(['width', 'lyricDistance', 'hideRepeatClef']));
        expect(labels(result)).not.toContain('%title:');
    });

    it('uses shared CompletionSection objects for ranked groups', () => {
        const result = complete('|');

        expect(option(result, '%title:').section).toBe(completionSections.headerKeys);
        expect(option(result, '%').section).toBe(completionSections.comments);
        expect(option(result, 'w:').section).toBe(completionSections.lineType);
        expect(option(result, '(g2)').section).toBe(completionSections.clefs);
        expect(option(result, '(K:)').section).toBe(completionSections.keySignatures);
        expect(option(result, '(z)').section).toBe(completionSections.layout);
        expect(option(result, ',').section).toBe(completionSections.barLines);
    });

    it('ranks clefs, key signatures, and line types above the other groups', () => {
        expect(completionSections.clefs.rank).toBeLessThan(completionSections.keySignatures.rank);
        expect(completionSections.keySignatures.rank).toBeLessThan(completionSections.lineType.rank);
        expect(completionSections.lineType.rank).toBeLessThan(completionSections.headerKeys.rank);
    });

    it('offers clef line numbers after a clef prefix', () => {
        const result = complete('(c|');

        expect(labels(result)).toEqual(expect.arrayContaining(['(c1)', '(c2)', '(c3)', '(c4)']));
        expect(labels(result)).toEqual(expect.arrayContaining(['(g2)', '(f4)']));
    });

    it('offers only predefined key signatures after a key-signature prefix', () => {
        const result = complete('(K:|');

        expect(labels(result)).toEqual([
            '(K:b)',
            '(K:F#)',
            '(K:F# K:F# C# G#)',
            '(K:)',
        ]);
    });

    it('does not complete inside an existing music-line comment', () => {
        expect(complete('(g2) g % comment|')).toBeNull();
    });
});
