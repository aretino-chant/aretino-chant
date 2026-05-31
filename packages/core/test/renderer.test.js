import { describe, it, expect } from 'vitest';
import { parseAretino, renderAretino, splitRowSVGs } from '../src/index.js';
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

function firstLyricSize(svg) {
  const m = svg.match(/<text[^>]*?xml:space="preserve"[^>]*? font-size="([^"]+)"/);
  return m ? parseFloat(m[1]) : null;
}

function textFontFamilies(svg) {
  return [...svg.matchAll(/<text[^>]*? font-family="([^"]+)"/g)].map(m => m[1]);
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

function viewBoxBottom(svg) {
  const m = svg.match(/viewBox="([^"]+)"/);
  if (!m) return null;
  const [, y, , h] = m[1].split(/\s+/).map(Number);
  return y + h;
}

function maxLineY(svg) {
  const ys = [...svg.matchAll(/\sy[12]="([^"]+)"/g)].map(m => Number(m[1]));
  return Math.max(...ys);
}

function staffBottom(svg) {
  const m = svg.match(/data-staff-bottom="([^"]+)"/);
  return m ? Number(m[1]) : null;
}

function renderedStaffSpace(svg) {
  const ys = [...svg.matchAll(/<line[^>]* y1="([^"]+)" x2=/g)]
    .slice(0, METRICS.staffLineCount)
    .map(m => Number(m[1]));
  return Math.abs(ys[0] - ys[1]);
}

describe('renderAretino', () => {
  it('produces a string containing <svg', () => {
    const ast = parseAretino('');
    const svg = renderAretino(ast);
    expect(svg).toBeTypeOf('string');
    expect(svg).toContain('<svg');
  });

  it('wraps each note modifier glyph in its own source-mapped group', () => {
    const svg = renderAretino('(g2) g-.');
    const groups = sourceMappedGroups(svg);
    const ictus = groups.find(g => g.className.includes('aretino-mod-ictus'));
    const mora = groups.find(g => g.className.includes('aretino-mod-mora'));

    const noteStart = '(g2) '.length;
    expect(ictus).toMatchObject({ srcStart: noteStart + 1, srcEnd: noteStart + 2 });
    expect(mora).toMatchObject({ srcStart: noteStart + 2, srcEnd: noteStart + 3 });
    for (const g of [ictus, mora]) {
      expect(g.className).toContain('aretino-modifier');
    }
  });

  it('separates two mora dots that land at the same vertical position', () => {
    // Two notes at the same pitch both carrying a mora (e.g. a.a. where both
    // notes happen to share the same staff position) must not overlap.
    const svg = renderAretino('(g2) a.a.');
    const circles = [...svg.matchAll(/<circle[^>]*>/g)].map(m => {
      const cy = m[0].match(/cy="([^"]+)"/)?.[1];
      return cy ? parseFloat(cy) : null;
    }).filter(v => v !== null);
    // There should be exactly two mora dots and their cy values must differ.
    expect(circles.length).toBe(2);
    expect(circles[0]).not.toBeCloseTo(circles[1], 1);
  });

  it('sizes lyricless row splits to include below-staff ligature ink', () => {
    const row = splitRowSVGs(renderAretino('(g2) A\'_-', { width: 600 }))?.[0];
    expect(row).toBeTruthy();
    expect(viewBoxBottom(row)).toBeGreaterThanOrEqual(maxLineY(row));
  });

  it('sizes lyricless row splits to include clefs below the staff', () => {
    const row = splitRowSVGs(renderAretino('(g1)', { width: 600 }))?.[0];
    expect(row).toBeTruthy();
    expect(viewBoxBottom(row)).toBeGreaterThan(staffBottom(row) + renderedStaffSpace(row));
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
      expect(firstLyricSize(svgWithOptions)).toBeCloseTo(20 * 96 / 72, 5);
    });

    it('applies textFont to rendered text from option headers and API options', () => {
      const source = `%option: textFont=Header Text\n%%\n${body}`;
      const svgFromHeader = renderAretino(source);
      const svgFromOptions = renderAretino(body, { textFont: 'API Text' });

      expect(textFontFamilies(svgFromHeader)).toContain('Header Text');
      expect(textFontFamilies(svgFromOptions)).toContain('API Text');
    });

  });

  describe('measure accidentals across wrapped rows', () => {
    it('repeats a preceding accidental before the first affected neume after an automatic wrap', () => {
      const source = '(g2) (b) b b b b b b b b b b b b b b b b | b b';
      const svg = renderAretino(source, { width: 150, hideRepeatClef: true });

      expect(courtesyAccidentalCount(svg)).toBe(1);
    });

    it('matches active accidentals by staff position after an explicit break', () => {
      const svg = renderAretino('(b)b (z) b |', { width: 400, hideRepeatClef: true });

      expect(courtesyAccidentalCount(svg)).toBe(1);
    });

    it('matches active accidentals by staff position after an automatic wrap', () => {
      const source = '(b)b b b b b b b b b b b b b b b b b b |';
      const svg = renderAretino(source, { width: 150, hideRepeatClef: true });

      expect(courtesyAccidentalCount(svg)).toBe(1);
    });

    it('does not repeat a preceding accidental for unaffected staff positions', () => {
      const svg = renderAretino('(g2) (b) (Z) a a', { width: 400, hideRepeatClef: true });

      expect(courtesyAccidentalCount(svg)).toBe(0);
    });

    it('clears measure accidentals at barlines', () => {
      const svg = renderAretino('(g2) (b) b | (Z) b b', { width: 400, hideRepeatClef: true });

      expect(courtesyAccidentalCount(svg)).toBe(0);
    });

    it('lets another accidental on the same staff position replace the previous one', () => {
      const svg = renderAretino('(g2) (b) a a (Z) (n) b b', { width: 400, hideRepeatClef: true });

      expect(courtesyAccidentalCount(svg)).toBe(0);
    });

    it('treats inline accidentals as active until the next barline or replacement accidental', () => {
      const svg = renderAretino('(g2) (fb) f (Z) f f', { width: 400, hideRepeatClef: true });

      expect(courtesyAccidentalCount(svg)).toBe(1);
    });
  });

  describe('lyric alignment', () => {
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

    it('excludes trailing punctuation from centering so the core text is centered', () => {
      const options = { width: 200, staffSpaceMm: 25.4 / 96 };
      // Without trailing punctuation the text element x equals the ligature center.
      const xNoPunct = firstLyricX(renderAretino('c\nw: ia', options));
      // With trailing "." the core "ia" must still be centered, so the text
      // element x (text-anchor="middle" over the full "ia.") shifts right by
      // half the dot's width.
      const xWithPunct = firstLyricX(renderAretino('c\nw: ia.', options));

      expect(xNoPunct).not.toBeNull();
      expect(xWithPunct).not.toBeNull();
      expect(xWithPunct).toBeGreaterThan(xNoPunct);
    });

    it('preserves small and large formatting in aligned lyric syllables', () => {
      const svg = renderAretino('c d e\nw: First \\small{Second} \\large{Third}', { width: 600 });

      expect(svg).toContain('<tspan style="font-size:0.75em">Second</tspan>');
      expect(svg).toContain('<tspan style="font-size:1.3333333em">Third</tspan>');
    });

    describe('Hungarian double consonant rule', () => {
      // noteSpacing:0.3 puts notes so close together that the inter-syllable hyphen
      // has no room and is collapsed.  noteSpacing:3 spreads notes wide enough that
      // the hyphen IS rendered — the transform must NOT fire in that case.

      it('transforms sz+sz boundary to osszad when the hyphen is collapsed', () => {
        const svg = renderAretino('c d\nw: osz-szad', { width: 400, noteSpacing: 0.3 });
        const texts = lyricTextEntries(svg).map(l => l.text);
        expect(texts).toContain('oss');
        expect(texts).toContain('zad');
        expect(renderedHyphenCount(svg)).toBe(0);
      });

      it('does NOT transform sz+sz when the hyphen has room to be shown', () => {
        const svg = renderAretino('c d\nw: osz-szad', { width: 400, noteSpacing: 3 });
        const texts = lyricTextEntries(svg).map(l => l.text);
        expect(texts).toContain('osz');
        expect(texts).toContain('szad');
        expect(renderedHyphenCount(svg)).toBe(1);
      });

      it('transforms cs+cs boundary when collapsed (e.g. ecs-cset)', () => {
        const svg = renderAretino('c d\nw: ecs-cset', { width: 400, noteSpacing: 0.3 });
        const texts = lyricTextEntries(svg).map(l => l.text);
        expect(texts).toContain('ecc');
        expect(texts).toContain('set');
        expect(renderedHyphenCount(svg)).toBe(0);
      });

      it('transforms gy+gy boundary when collapsed (egy-gyel)', () => {
        const svg = renderAretino('c d\nw: egy-gyel', { width: 400, noteSpacing: 0.3 });
        const texts = lyricTextEntries(svg).map(l => l.text);
        expect(texts).toContain('egg');
        expect(texts).toContain('yel');
      });

      it('does not alter a simple tt boundary (naive concatenation is correct)', () => {
        const svg = renderAretino('c d\nw: kat-tán', { width: 400, noteSpacing: 0.3 });
        const texts = lyricTextEntries(svg).map(l => l.text);
        expect(texts).toContain('kat');
        expect(texts).toContain('tán');
      });

      it('does not affect syllables from different words', () => {
        const svg = renderAretino('c d\nw: osz szad', { width: 400, noteSpacing: 0.3 });
        const texts = lyricTextEntries(svg).map(l => l.text);
        expect(texts).toContain('osz');
        expect(texts).toContain('szad');
      });
    });

    describe('\\- literal hyphen escape', () => {
      it('renders \\- as a literal hyphen within a single syllable', () => {
        const svg = renderAretino('c\nw: rülsz\\-e', { width: 400 });
        const texts = lyricTextEntries(svg).map(l => l.text);
        expect(texts).toEqual(['rülsz-e']);
        expect(renderedHyphenCount(svg)).toBe(0);
      });

      it('\\- does not split a syllable under a melismatic tenor note', () => {
        const svg = renderAretino('c\nw: Vajon~megkönyörülsz\\-e~rajtunk', { width: 600 });
        const texts = lyricTextEntries(svg).map(l => l.text);
        expect(texts).toEqual(['Vajon megkönyörülsz-e rajtunk']);
        expect(renderedHyphenCount(svg)).toBe(0);
      });
    });

    describe('= mandatory-hyphen separator', () => {
      it('= separator always shows a hyphen even when space is tight', () => {
        const svg = renderAretino('c d\nw: rülsz=e', { width: 400, noteSpacing: 0.3 });
        const texts = lyricTextEntries(svg).map(l => l.text);
        expect(texts).toContain('rülsz');
        expect(texts).toContain('e');
        expect(renderedHyphenCount(svg)).toBe(1);
      });

      it('= separator shows a hyphen when space is ample', () => {
        const svg = renderAretino('c d\nw: rülsz=e', { width: 400, noteSpacing: 3 });
        const texts = lyricTextEntries(svg).map(l => l.text);
        expect(texts).toContain('rülsz');
        expect(texts).toContain('e');
        expect(renderedHyphenCount(svg)).toBe(1);
      });

      it('== separator spans 2 notes and always shows both hyphens', () => {
        const svg = renderAretino('c d e\nw: rülsz==e', { width: 400, noteSpacing: 0.3 });
        const texts = lyricTextEntries(svg).map(l => l.text);
        expect(texts).toContain('rülsz');
        expect(texts).toContain('e');
        expect(renderedHyphenCount(svg)).toBe(2);
      });

      it('= does not apply the Hungarian digraph transform even when tight', () => {
        const svg = renderAretino('c d\nw: osz=szad', { width: 400, noteSpacing: 0.3 });
        const texts = lyricTextEntries(svg).map(l => l.text);
        expect(texts).toContain('osz');
        expect(texts).toContain('szad');
        expect(renderedHyphenCount(svg)).toBe(1);
      });
    });
  });

  describe('tenor recitation wrapping', () => {
    const PHRASE = 'alpha~beta~gamma~delta~epsilon~zeta~eta~theta~iota~kappa';
    const tenorGlyphCount = svg => (svg.match(/aretino-token aretino-ligature/g) || []).length;

    it('wraps a long recited phrase across rows, repeating the tenor notehead', () => {
      const svg = renderAretino(`at\nw: ${PHRASE}`, { width: 200 });
      const lyr = lyricTextEntries(svg);
      const rows = new Set(lyr.map(l => l.y)).size;
      // All ten words still rendered, split over more than one row.
      expect(lyr.map(l => l.text)).toEqual(PHRASE.split('~'));
      expect(rows).toBeGreaterThan(1);
      // One tenor notehead is drawn at the start of every row.
      expect(tenorGlyphCount(svg)).toBe(rows);
    });

    it('keeps a phrase that fits on one line with a single tenor notehead', () => {
      const svg = renderAretino(`at\nw: ${PHRASE}`, { width: 2000 });
      const lyr = lyricTextEntries(svg);
      expect(new Set(lyr.map(l => l.y)).size).toBe(1);
      expect(tenorGlyphCount(svg)).toBe(1);
    });

    it('does not expand a single-word tenor syllable', () => {
      const svg = renderAretino('at\nw: solo', { width: 600 });
      expect(tenorGlyphCount(svg)).toBe(1);
      expect(lyricTextEntries(svg).map(l => l.text)).toEqual(['solo']);
    });

    it('renders following notes after a wrapped recitation', () => {
      const svg = renderAretino(`at b |\nw: ${PHRASE}`, { width: 200 });
      const lyr = lyricTextEntries(svg);
      const rows = new Set(lyr.map(l => l.y)).size;
      // Recited words plus the trailing plain note: one tenor glyph per row + b.
      expect(lyr.map(l => l.text)).toEqual(PHRASE.split('~'));
      expect(tenorGlyphCount(svg)).toBe(rows + 1);
    });

    it('keeps a hyphen-joined syllable snug after the recited phrase', () => {
      // The last recited word inherits the phrase's trailing hyphen ("orosz-lán"),
      // so the following syllable butts up with a hyphen gap, not a word gap —
      // matching a plain (non-recited) tenor + note pair.
      const lyrX = svg => [...svg.matchAll(/<text[^>]*?xml:space="preserve"[^>]*? x="([^"]+)"[^>]*? y="([^"]+)"[^>]*>(.*?)<\/text>/g)]
        .map(m => ({ x: parseFloat(m[1]), y: parseFloat(m[2]), text: m[3].replace(/<[^>]*>/g, '') }));
      const gapBetween = (svg, a, b) => {
        const xs = lyrX(svg);
        const ai = xs.find(e => e.text === a);
        // The following syllable shares the last recited word's row.
        const bi = xs.find(e => e.text === b && e.y === ai.y);
        return bi.x - ai.x;
      };
      const recited = renderAretino('at b |\nw: alpha~beta~orosz-lán', { width: 300 });
      const plain = renderAretino('at b |\nw: orosz-lán', { width: 600 });
      expect(gapBetween(recited, 'orosz', 'lán')).toBeCloseTo(gapBetween(plain, 'orosz', 'lán'), 1);
    });
  });

  describe('source-mapped caret elements', () => {
    it('can render without interactive source-map and highlight markup', () => {
      const svg = renderAretino('(g2) g-.', { sourceMap: false });

      expect(svg).not.toContain('data-src-start');
      expect(svg).not.toContain('aretino-active');
      expect(svg).not.toContain('aretino-cursor');
      expect(svg).not.toContain('aretino-token');
      expect(svg).not.toContain('aretino-note');
      expect(svg).not.toContain('aretino-modifier');
    });

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
      const source = 'f(b)a';
      const groups = sourceMappedGroups(renderAretino(source, { width: 400, hideRepeatClef: true }));

      expect(groups).toContainEqual(expect.objectContaining({
        className: expect.stringContaining('aretino-inline-accidental'),
        srcStart: source.indexOf('(b)'),
        srcEnd: source.indexOf('(b)') + 3,
      }));
      expect(groups).toContainEqual(expect.objectContaining({
        className: expect.stringContaining('aretino-note'),
        srcStart: source.indexOf('a'),
        srcEnd: source.indexOf('a') + 1,
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

  describe('verse lines', () => {
    it('preserves small and large formatting in wrapped verse text', () => {
      const svg = renderAretino('c\nW: First \\small{Second} \\large{Third}', { width: 600 });

      expect(svg).toContain('<tspan style="font-size:0.75em">Second</tspan>');
      expect(svg).toContain('<tspan style="font-size:1.3333333em">Third</tspan>');
    });
  });

  describe('barline labels', () => {
    it('places a barline label after a multi-neume syllable under the correct barline', () => {
      // "cae--" spans 2 ligatures; "(V)" should land under || (3rd barline), not the 2nd comma
      const source = 'c d , f , g ||\nw: in cae--lis. (V)';
      const svg = renderAretino(source, { width: 800 });

      // Collect all barline center X values from the rendered SVG
      const barlineXs = [...svg.matchAll(/class="[^"]*aretino-barline[^"]*"[^>]*>\s*<[^>]+x1="([^"]+)"/g)]
        .map(m => parseFloat(m[1]));

      // Extract the barline-label X position
      const labelMatch = svg.match(/class="[^"]*aretino-barline-label[^"]*"[^>]*>[\s\S]*?<text[^>]*x="([^"]+)"/);
      const labelX = labelMatch ? parseFloat(labelMatch[1]) : null;

      // The label must appear and its X must equal the last (||) barline's center X
      expect(labelX).not.toBeNull();
      expect(labelX).toBeGreaterThan(barlineXs[1]);
    });
  });

  describe('justification', () => {
    // Rightmost staff-line end = the right margin (staffRightX).
    function staffRightX(svg) {
      const xs = [...svg.matchAll(/<line[^>]* x2="([^"]+)" y2=/g)].map(m => parseFloat(m[1]));
      return xs.length ? Math.max(...xs) : null;
    }
    function barlineX1s(svg) {
      return [...svg.matchAll(/class="[^"]*aretino-barline[^"]*"[^>]*>\s*<[^>]+x1="([^"]+)"/g)]
        .map(m => parseFloat(m[1]));
    }

    it('leaves only barlinePostGap after a barline that ends a justified row', () => {
      // (z) forces a justified break, so the first row ends with the barline and
      // is stretched to the right margin. The barline must keep only its normal
      // post-gap before the margin — the same as an automatic wrap — instead of
      // a wider reserve surviving as a void.
      const svg = renderAretino('g g g g | (z) g g g g', { width: 600, hideRepeatClef: true });
      const rows = splitRowSVGs(svg);
      expect(rows.length).toBeGreaterThan(1);

      const firstRow = rows[0];
      const bars = barlineX1s(firstRow);
      expect(bars.length).toBeGreaterThan(0);
      const barX1 = Math.max(...bars);
      const rightX = staffRightX(firstRow);
      const ss = renderedStaffSpace(firstRow);

      // Barline glyph right edge = x1 - barlineOffsetX(0.3ss) + barlineAdvance(0.8ss).
      // The remaining gap to the margin must equal one barlinePostGap (0.5ss).
      const glyphRightEdge = barX1 - 0.3 * ss + 0.8 * ss;
      expect(rightX - glyphRightEdge).toBeCloseTo(METRICS.barlinePostGap * ss, 1);
    });

    it('keeps the line-final barline gap independent of trailing syllable reserve', () => {
      // The note after the barline carries a wide syllable, which reserves extra
      // space after the barline (barlinePostExtra). When (z) breaks the row right
      // after the barline, that reserve must not survive and push the barline away
      // from the margin — the line-final barline lands in the same place whether
      // the wrapped-away syllable is narrow or wide.
      const narrow = renderAretino('g g | (z) g\nw: a a b', { width: 600 });
      const wide = renderAretino('g g | (z) g\nw: a a Wiiiiiiiiiide', { width: 600 });

      const barX = svg => Math.max(...barlineX1s(splitRowSVGs(svg)[0]));
      expect(barX(narrow)).toBeCloseTo(barX(wide), 1);
    });
  });

  describe('slur spans', () => {
    it('renders a dashed slur arc below notes', () => {
      const svg = renderAretino('c = \\slur{c d}', { width: 600 });
      expect(svg).toContain('stroke-dasharray');
      expect(svg).toContain('<path d="M');
    });

    it('renders a solid slur arc without dasharray', () => {
      const svg = renderAretino('c = \\slurSolid{c d}', { width: 600 });
      // Staff lines use fill="none" too; confirm a path exists without dasharray
      expect(svg).not.toContain('stroke-dasharray');
      expect(svg).toContain('<path d="M');
    });

    it('places slur arc y below all spanned note y positions', () => {
      const svg = renderAretino('c = \\slur{c d}', { width: 600 });
      const m = svg.match(/stroke-dasharray="[^"]*"\s*\/>/);
      expect(m).toBeTruthy();
    });

    it('ignores an unmatched slur open (no crash)', () => {
      expect(() => renderAretino('c = \\slur{c d', { width: 600 })).not.toThrow();
    });
  });

  // TODO: snapshot a known sample once examples/sample.aretino is filled in.
});
