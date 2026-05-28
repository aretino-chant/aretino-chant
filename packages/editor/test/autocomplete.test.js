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
        expect(labels(result)).toEqual(expect.arrayContaining(['width', 'textFont', 'lyricDistance', 'hideRepeatClef']));
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

    it('does not complete inside an existing music-line comment', () => {
        expect(complete('(g2) g % comment|')).toBeNull();
    });

    it('music line still offers music options in body', () => {
        const result = complete('(g2) g\n|');
        expect(labels(result)).toContain('(g2)');
        expect(labels(result)).toContain(',');
        expect(labels(result)).toContain('w:');
    });
});

describe('lyrics/verse line context', () => {
    it('offers text formatting on \\ in a lyrics line', () => {
        const result = complete('(g2) g\nw: some text\\|');
        expect(labels(result)).toContain('\\R');
        expect(labels(result)).toContain('\\V');
        expect(labels(result)).toContain('\\small{');
        expect(labels(result)).not.toContain('(g2)');
        expect(labels(result)).not.toContain('w:');
    });

    it('offers text formatting on \\ in a verse line', () => {
        const result = complete('W: some text\\|');
        expect(labels(result)).toContain('\\R');
        expect(labels(result)).toContain('\\sc{');
        expect(labels(result)).not.toContain('(g2)');
    });

    it('offers text formatting on explicit invoke in a lyrics line', () => {
        const result = complete('(g2) g\nw: |');
        expect(labels(result)).toContain('\\R');
        expect(labels(result)).not.toContain('(g2)');
        expect(labels(result)).not.toContain(',');
    });

    it('offers text formatting on explicit invoke at start of lyrics line', () => {
        const result = complete('(g2) g\nw:|');
        expect(labels(result)).toContain('\\R');
        expect(labels(result)).not.toContain('(g2)');
    });

    it('offers text formatting in continuation lines after lyrics', () => {
        const result = complete('w: first line\ncontinuation \\|');
        expect(labels(result)).toContain('\\R');
        expect(labels(result)).not.toContain('(g2)');
    });

    it('returns null for non-explicit mid-lyrics without \\', () => {
        expect(complete('w: some text|', false)).toBeNull();
    });
});

describe('mid-line music context', () => {
    it('offers music options on explicit invoke mid-line', () => {
        const result = complete('(g2) g a |');
        expect(labels(result)).toContain(',');
        expect(labels(result)).toContain('|');
        expect(labels(result)).toContain('(g2)');
        expect(labels(result)).toContain('\\arc{');
        expect(labels(result)).not.toContain('w:');
        expect(labels(result)).not.toContain('%title:');
    });

    it('does not offer completions mid-line without trigger (non-explicit)', () => {
        expect(complete('(g2) g a |', false)).toBeNull();
    });

    it('offers parenthesized options after ( mid-line', () => {
        const result = complete('(g2) g (|');
        expect(labels(result)).toContain('(g2)');
        expect(labels(result)).toContain('(K:)');
        expect(labels(result)).toContain('(z)');
    });

    it('offers clef options after clef letter mid-line', () => {
        const result = complete('(g2) g (c|');
        expect(labels(result)).toContain('(c1)');
        expect(labels(result)).toContain('(c3)');
        expect(labels(result)).toContain('(c4)');
    });

    it('offers music span options after \\ mid-line', () => {
        const result = complete('(g2) g \\|');
        expect(labels(result)).toContain('\\arc{');
        expect(labels(result)).toContain('\\line{');
        expect(labels(result)).not.toContain('\\R');
        expect(labels(result)).not.toContain('(g2)');
    });

    it('does not offer completions inside a mid-line comment', () => {
        expect(complete('(g2) g % comment |')).toBeNull();
    });
});
