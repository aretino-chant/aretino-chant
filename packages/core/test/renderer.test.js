import { describe, it, expect } from 'vitest';
import { parseAretino, renderAretino } from '../src/index.js';
import { METRICS } from '../src/glyphs.js';

function firstLyricY(svg) {
  // Extract the y attribute from the first <text> element that contains
  // lyric content (identified by xml:space="preserve"). Use non-greedy
  // match to avoid stopping at the 'y=' inside 'font-family='.
  const m = svg.match(/<text[^>]*?xml:space="preserve"[^>]*? y="([^"]+)"/);
  return m ? parseFloat(m[1]) : null;
}

function firstLyricX(svg) {
  const m = svg.match(/<text[^>]*?xml:space="preserve"[^>]*? x="([^"]+)"/);
  return m ? parseFloat(m[1]) : null;
}

function firstLyricFontSize(svg) {
  const m = svg.match(/<text[^>]*?xml:space="preserve"[^>]*? font-size="([^"]+)"/);
  return m ? parseFloat(m[1]) : null;
}

function courtesyAccidentalCount(svg) {
  return (svg.match(/aretino-courtesy-accidental/g) || []).length;
}

describe('renderAretino', () => {
  it('produces a string containing <svg', () => {
    const ast = parseAretino('');
    const svg = renderAretino(ast);
    expect(svg).toBeTypeOf('string');
    expect(svg).toContain('<svg');
  });

  describe('lyricDistance option', () => {
    // Source with a music line and a matching lyric line.
    const source = 'c d e f\nw: a b c d';

    it('accepts a positive lyricDistance and positions lyrics further from staff', () => {
      const svgDefault = renderAretino(source);
      const svgFarther = renderAretino(source, { lyricDistance: 2 });
      const yDefault = firstLyricY(svgDefault);
      const yFarther = firstLyricY(svgFarther);
      expect(yDefault).not.toBeNull();
      expect(yFarther).toBeGreaterThan(yDefault);
    });

    it('accepts a negative lyricDistance and positions lyrics closer to (or inside) the staff', () => {
      const svgDefault = renderAretino(source);
      const svgCloser = renderAretino(source, { lyricDistance: -1 });
      const yDefault = firstLyricY(svgDefault);
      const yCloser = firstLyricY(svgCloser);
      expect(yDefault).not.toBeNull();
      expect(yCloser).toBeLessThan(yDefault);
    });

    it('accepts lyricDistance of zero without error', () => {
      const svg = renderAretino(source, { lyricDistance: 0 });
      expect(svg).toContain('<svg');
    });
  });

  describe('option headers', () => {
    const body = 'c d e f\nw: a b c d';

    it('applies multiple option headers to renderer options', () => {
      const source = `%option: lyricDistance=2\n%option: lyricSize=20\n%%\n${body}`;
      const svgDefault = renderAretino(body);
      const svgWithOptions = renderAretino(source);

      expect(firstLyricY(svgWithOptions)).toBeGreaterThan(firstLyricY(svgDefault));
      expect(firstLyricFontSize(svgWithOptions)).toBeCloseTo(20 * 96 / 72, 5);
    });

    it('lets explicit render options override option headers', () => {
      const source = `%option: lyricDistance=2\n%%\n${body}`;
      const svgWithOverride = renderAretino(source, { lyricDistance: 0 });
      const svgExplicit = renderAretino(body, { lyricDistance: 0 });

      expect(firstLyricY(svgWithOverride)).toBeCloseTo(firstLyricY(svgExplicit), 5);
    });
  });

  describe('measure accidentals across wrapped rows', () => {
    it('repeats a preceding accidental before the first affected neume after an automatic wrap', () => {
      const source = '(g2) (b) i i i i i i i i i i i i i i i i | i i';
      const svg = renderAretino(source, { width: 150, hideRepeatClef: true });

      expect(courtesyAccidentalCount(svg)).toBe(1);
    });

    it('does not repeat a preceding accidental for unaffected staff positions', () => {
      const svg = renderAretino('(g2) (b) (Z) h h', { width: 400, hideRepeatClef: true });

      expect(courtesyAccidentalCount(svg)).toBe(0);
    });

    it('clears measure accidentals at barlines', () => {
      const svg = renderAretino('(g2) (b) i | (Z) i i', { width: 400, hideRepeatClef: true });

      expect(courtesyAccidentalCount(svg)).toBe(0);
    });

    it('lets another accidental on the same staff position replace the previous one', () => {
      const svg = renderAretino('(g2) (b) h h (Z) (n) i i', { width: 400, hideRepeatClef: true });

      expect(courtesyAccidentalCount(svg)).toBe(0);
    });

    it('treats inline accidentals as active until the next barline or replacement accidental', () => {
      const svg = renderAretino('(g2) (fb) f (Z) f f', { width: 400, hideRepeatClef: true });

      expect(courtesyAccidentalCount(svg)).toBe(1);
    });
  });

  describe('lyric alignment', () => {
    it('centers a single-note mora syllable under the notehead and mora dot', () => {
      const options = { width: 200, staffSpaceMm: 25.4 / 96 };
      const plainX = firstLyricX(renderAretino('c\nw: a', options));
      const moraX = firstLyricX(renderAretino('c.\nw: a', options));
      const expectedShift = (METRICS.moraOffsetX + METRICS.moraRadius - METRICS.noteBoxWidth * 0.5) * 0.5;

      expect(plainX).not.toBeNull();
      expect(moraX).not.toBeNull();
      expect(moraX).toBeGreaterThan(plainX);
      expect(moraX - plainX).toBeCloseTo(expectedShift, 5);
    });
  });

  // TODO: snapshot a known sample once examples/sample.aretino is filled in.
});
