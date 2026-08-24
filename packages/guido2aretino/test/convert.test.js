import { describe, it, expect } from 'vitest';
import { guidoToAretino } from '../src/convert.js';

describe('guidoToAretino', () => {
    it('converts pitch characters', () => {
        expect(guidoToAretino('0')).toBe('c');
        expect(guidoToAretino('4')).toBe('g');
        expect(guidoToAretino('7')).toBe('C');
    });

    it('uses uppercase pitches outside the normal octave', () => {
        expect(guidoToAretino('ð-ñ-0-1-2-3-4-5-6-7-8'))
            .toBe('A B c d e f g a b C D');
    });

    it('converts virga pitch characters', () => {
        expect(guidoToAretino('q')).toBe("d'");
        expect(guidoToAretino('r')).toBe("g'");
    });

    it('converts clef characters', () => {
        expect(guidoToAretino('<')).toBe('(g2)');
        expect(guidoToAretino('}')).toBe('(f4)');
    });

    it('converts barline characters', () => {
        expect(guidoToAretino(',')).toBe('|');
        expect(guidoToAretino('.')).toBe('|||');
        expect(guidoToAretino(':')).toBe(',');
    });

    it('attaches mora dot to preceding note', () => {
        expect(guidoToAretino('0y')).toBe('c.');
        expect(guidoToAretino('4x')).toBe('g.');
    });

    it('converts plica characters to ~', () => {
        expect(guidoToAretino("0'1")).toBe('c~d');
    });

    it('inserts space between dash-separated tokens', () => {
        expect(guidoToAretino('0-1')).toBe('c d');
        expect(guidoToAretino('0---1')).toBe('c d');
    });

    it('converts key signature characters', () => {
        expect(guidoToAretino('<X')).toBe('(g2)(Kb)');
        expect(guidoToAretino('0X')).toBe('c(b)');
        expect(guidoToAretino('<ô')).toBe('(g2)(K:F#)');
        expect(guidoToAretino('<ôþ')).toBe('(g2)(K:F# C#)');
        expect(guidoToAretino('<ôþÐ')).toBe('(g2)(K:F# C# G#)');
        expect(guidoToAretino('0ô')).toBe('c(F#)');
        expect(guidoToAretino('0þ')).toBe('c(C#)');
        expect(guidoToAretino('0Ð')).toBe('c(g#)');
    });

    it('converts quilisma characters', () => {
        expect(guidoToAretino('â')).toBe('cw');
        expect(guidoToAretino('æ')).toBe('gw');
    });

    it('ignores unrecognised characters', () => {
        expect(guidoToAretino('0 1')).toBe('cd');
    });

    it('converts a short melodic phrase', () => {
        expect(guidoToAretino('<-0-1-2-3')).toBe('(g2) c d e f');
    });
});
