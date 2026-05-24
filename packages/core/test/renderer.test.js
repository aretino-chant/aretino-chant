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

function lyricTextEntries(svg) {
  return [...svg.matchAll(/<text[^>]*?xml:space="preserve"[^>]*? y="([^"]+)"[^>]*>(.*?)<\/text>/g)]
    .map(m => ({
      y: parseFloat(m[1]),
      text: m[2].replace(/<[^>]*>/g, ''),
    }));
}

function courtesyAccidentalCount(svg) {
  return (svg.match(/aretino-courtesy-accidental/g) || []).length;
}

function renderedHyphenCount(svg) {
  return (svg.match(/<text[^>]*>-<\/text>/g) || []).length;
}

function sourceMappedGroups(svg) {
  return [...svg.matchAll(/<g class="([^"]*)" data-src-start="([^"]+)" data-src-end="([^"]+)"/g)]
    .map(m => ({
      className: m[1],
      srcStart: Number(m[2]),
      srcEnd: Number(m[3]),
    }));
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

    it('matches active accidentals by staff position after an explicit break', () => {
      const svg = renderAretino('(b)B (z) B |', { width: 400, hideRepeatClef: true });

      expect(courtesyAccidentalCount(svg)).toBe(1);
    });

    it('matches active accidentals by staff position after an automatic wrap', () => {
      const source = '(b)B B B B B B B B B B B B B B B B B B |';
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

    it('keeps lyrics after n: on the same aligned lyric baseline', () => {
      const svg = renderAretino('c d\nw: a b\nn: e f\nw: c d', { width: 400 });
      const lyrics = lyricTextEntries(svg);
      const baseline = lyrics[0].y;

      expect(lyrics.map(l => l.text)).toEqual(['a', 'b', 'c', 'd']);
      expect(lyrics.every(l => l.y === baseline)).toBe(true);
    });

    it('allows whitespace after lyric syllable hyphens', () => {
      const source = 'c = = d = = e\nw: Ky-    ri-     e';
      const svg = renderAretino(source, { width: 600 });

      expect(lyricTextEntries(svg).map(l => l.text)).toEqual(['Ky', 'ri', 'e']);
      expect(renderedHyphenCount(svg)).toBe(2);
    });
  });

  describe('source-mapped caret elements', () => {
    it('maps clefs, standalone accidentals, and barlines to source spans', () => {
      const source = '(c3) (b) |';
      const groups = sourceMappedGroups(renderAretino(source, { width: 400, hideRepeatClef: true }));

      expect(groups).toContainEqual(expect.objectContaining({
        className: expect.stringContaining('aretino-clef'),
        srcStart: source.indexOf('(c3)'),
        srcEnd: source.indexOf('(c3)') + 4,
      }));
      expect(groups).toContainEqual(expect.objectContaining({
        className: expect.stringContaining('aretino-accidental'),
        srcStart: source.indexOf('(b)'),
        srcEnd: source.indexOf('(b)') + 3,
      }));
      expect(groups).toContainEqual(expect.objectContaining({
        className: expect.stringContaining('aretino-barline'),
        srcStart: source.indexOf('|'),
        srcEnd: source.indexOf('|') + 1,
      }));
    });

    it('maps inline accidentals independently from their note', () => {
      const source = 'i(b)j';
      const groups = sourceMappedGroups(renderAretino(source, { width: 400, hideRepeatClef: true }));

      expect(groups).toContainEqual(expect.objectContaining({
        className: expect.stringContaining('aretino-inline-accidental'),
        srcStart: source.indexOf('(b)'),
        srcEnd: source.indexOf('(b)') + 3,
      }));
      expect(groups).toContainEqual(expect.objectContaining({
        className: expect.stringContaining('aretino-note'),
        srcStart: source.indexOf('j'),
        srcEnd: source.indexOf('j') + 1,
      }));
    });

    it('maps aligned lyric syllables without mapping lyric hyphens', () => {
      const source = 'c = = d\nw: Ky-ri';
      const groups = sourceMappedGroups(renderAretino(source, { width: 600, hideRepeatClef: true }));

      expect(groups).toContainEqual(expect.objectContaining({
        className: expect.stringContaining('aretino-syllable'),
        srcStart: source.indexOf('Ky'),
        srcEnd: source.indexOf('Ky') + 2,
      }));
      expect(groups.some(g => g.className.includes('aretino-lyric-hyphen'))).toBe(false);
      expect(groups).toContainEqual(expect.objectContaining({
        className: expect.stringContaining('aretino-syllable'),
        srcStart: source.indexOf('ri'),
        srcEnd: source.indexOf('ri') + 2,
      }));
    });
  });

  // TODO: snapshot a known sample once examples/sample.aretino is filled in.
});
