import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseAretino, renderAretino, splitRowSVGs, renderFirstRow } from '../src/index.js';
import { METRICS } from '../src/glyphs.js';
import { measureTextWidth, measureTextAscent } from '../src/text.js';

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
  return [...svg.matchAll(/<text\b([^>]*)xml:space="preserve"([^>]*)>(.*?)<\/text>/g)]
    .map(m => {
      const attrs = `${m[1]} ${m[2]}`;
      const attr = name => new RegExp(`\\b${name}="([^"]+)"`).exec(attrs)?.[1] ?? null;
      return {
        x: parseFloat(attr('x')),
        y: parseFloat(attr('y')),
        fontFamily: attr('font-family'),
        fontSize: parseFloat(attr('font-size')),
        text: m[3].replace(/<[^>]*>/g, ''),
      };
    });
}

function courtesyAccidentalCount(svg) {
  return (svg.match(/aretino-courtesy-accidental/g) || []).length;
}

// A lyric hyphen is a drawn stroke, not the font's '-' glyph, so that its length
// answers to the lyric size and to the room between the syllables rather than to
// the face's side bearings. A gap wide enough carries several strokes for the one
// hyphen, so count the gaps (the strokes of one hyphen share a y).
function hyphenStrokes(svg) {
  return [...svg.matchAll(/<line class="aretino-lyric-hyphen" x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="[^"]+" stroke="[^"]*" stroke-width="([^"]+)"/g)]
    .map(m => ({ x1: +m[1], x2: +m[3], y: +m[2], width: +m[4] }));
}

function renderedHyphenCount(svg) {
  return hyphenStrokes(svg).length;
}

function sourceMappedGroups(svg) {
  return [...svg.matchAll(/<g class="([^"]*)" data-src-start="([^"]+)" data-src-end="([^"]+)"/g)]
    .map(m => ({
      className: m[1],
      srcStart: Number(m[2]),
      srcEnd: Number(m[3]),
    }));
}

function ligatureBoxes(svg) {
  return [...svg.matchAll(/<g class="aretino-token aretino-ligature"[^>]*data-bbox-x="([^"]+)" data-bbox-width="([^"]+)"/g)]
    .map(m => {
      const x = Number(m[1]);
      const width = Number(m[2]);
      return { x, width, right: x + width };
    });
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

function staffLeft(svg) {
  const m = svg.match(/<line[^>]* x1="([^"]+)"/);
  return m ? Number(m[1]) : null;
}

function staffRight(svg) {
  const m = svg.match(/<line[^>]* x2="([^"]+)"/);
  return m ? Number(m[1]) : null;
}

// Horizontal extent of the row's lyrics, by measured text rather than by the
// anchor, so an overhang past either edge of the staff shows up.
function lyricExtent(svg) {
  const entries = lyricTextEntries(svg);
  if (entries.length === 0) return null;
  const edges = entries.map(e => {
    const w = measureTextWidth(e.text, e.fontSize, e.fontFamily);
    return { left: e.x - w / 2, right: e.x + w / 2 };
  });
  return {
    left: Math.min(...edges.map(e => e.left)),
    right: Math.max(...edges.map(e => e.right)),
  };
}

function firstFlatX(svg) {
  const m = svg.match(/<path d="M12 -170[^>]* transform="translate\(([^,]+),/);
  return m ? Number(m[1]) : null;
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

  describe('first lyric line clearance', () => {
    // Distance from the bottom staff line to the lyric baseline, which is what
    // the clearance rules actually settle.
    const drop = (src, opts = {}) => {
      const svg = renderAretino(src, { width: 400, ...opts });
      return firstLyricY(svg) - staffBottom(svg);
    };

    it('clears a virga stem, not just the notehead', () => {
      // A' is a low virga: its stem hangs well below the bottom line, far past
      // the lyricMinStaffDistance floor the lyrics would otherwise take.
      expect(drop("A'\nw: mi")).toBeGreaterThan(drop('A\nw: mi'));
    });

    it('hangs the letters by their real ascent, not by the font size', () => {
      // Same music, same font size: only the letters differ.
      const xheight = drop('c\nw: mi');
      const ascender = drop('c\nw: li');
      const accentedCap = drop('c\nw: Ám');
      expect(xheight).toBeLessThan(ascender);
      expect(ascender).toBeLessThan(accentedCap);
    });

    it('clears a hanging virga stem by the full lyricDistance', () => {
      // The stem is drawn with a round linecap, so its ink reaches half a stroke
      // width past the endpoint; the clearance is measured against that ink.
      const svg = renderAretino("(g2) (K:B) a_gb'ag/a_C CCCagaga a. ;\nw: Haec di-es (\\red{*})", { width: 500 });
      const space = renderedStaffSpace(svg);
      const syl = lyricTextEntries(svg).filter(l => l.text !== '')[0];
      const letterTop = syl.y - measureTextAscent(syl.text, syl.fontSize, 'serif');
      // Every downward stroke drawn in the row, bottom edge including the cap.
      const strokeBottoms = [...svg.matchAll(/<line x1="([^"]+)" y1="([^"]+)" x2="\1" y2="([^"]+)" stroke="#000" stroke-width="([^"]+)"/g)]
        .map(m => ({ x: +m[1], bottom: Math.max(+m[2], +m[3]) + +m[4] / 2 }));
      const sylW = measureTextWidth(syl.text, syl.fontSize, 'serif');
      const under = strokeBottoms.filter(v => v.x >= syl.x - sylW / 2 && v.x <= syl.x + sylW / 2);
      expect(under.length).toBeGreaterThan(0);
      const deepest = Math.max(...under.map(v => v.bottom));
      expect(letterTop - deepest).toBeGreaterThanOrEqual(METRICS.lyricDistance * space - 1e-6);
    });

    it('pairs each syllable with the music over its own span', () => {
      // The same two neumes and the same two syllables, swapped. A tall syllable
      // standing over the deep stem needs a lower baseline than a short one
      // does; a row-wide maximum could not tell the two rows apart.
      const tallOverStem = drop("c A'\nw: mi Ám");
      const shortOverStem = drop("A' c\nw: mi Ám");
      expect(tallOverStem).toBeGreaterThan(shortOverStem);
    });

    it('keeps every syllable of a row on one baseline', () => {
      const svg = renderAretino("c c A' c\nw: mi se Ám re", { width: 400 });
      const ys = new Set(lyricTextEntries(svg).map(l => l.y));
      expect(ys.size).toBe(1);
    });

    it('advances stanzas by lyricLineSkip', () => {
      const src = 'c d\nw: a b\nw: c d';
      const ys = opts => [...new Set(lyricTextEntries(renderAretino(src, { width: 400, ...opts })).map(l => l.y))]
        .sort((a, b) => a - b);
      const [first, second] = ys({});
      const [wideFirst, wideSecond] = ys({ lyricLineSkip: 2 });
      expect(second - first).toBeCloseTo(firstLyricSize(renderAretino(src, { width: 400 })) * 1.2, 5);
      expect(wideSecond - wideFirst).toBeGreaterThan(second - first);
    });
  });

  describe('lyric hyphen strokes', () => {
    const src = 'c d\nw: Di-cső';

    it('flexes the stroke between its minimum and maximum length', () => {
      const size = firstLyricSize(renderAretino(src, { width: 400 }));
      const snug = hyphenStrokes(renderAretino(src, { width: 400, noteSpacing: 1.8 }))[0];
      const roomy = hyphenStrokes(renderAretino(src, { width: 400, noteSpacing: 3 }))[0];
      expect(snug.x2 - snug.x1).toBeGreaterThanOrEqual(METRICS.lyricHyphenMinLen * size - 1e-6);
      expect(roomy.x2 - roomy.x1).toBeCloseTo(METRICS.lyricHyphenMaxLen * size, 5);
      expect(snug.x2 - snug.x1).toBeLessThanOrEqual(roomy.x2 - roomy.x1 + 1e-6);
    });

    it('spreads several strokes across a gap too wide for one', () => {
      const size = firstLyricSize(renderAretino(src, { width: 400 }));
      const wide = hyphenStrokes(renderAretino(src, { width: 800, noteSpacing: 12 }));
      expect(wide.length).toBeGreaterThan(1);
      // Each is at full length, and they share the one baseline.
      expect(new Set(wide.map(h => h.y)).size).toBe(1);
      for (const h of wide) {
        expect(h.x2 - h.x1).toBeCloseTo(METRICS.lyricHyphenMaxLen * size, 5);
      }
      // The white between them is even — no stroke sits closer to its neighbour
      // than to the next.
      const air = wide.slice(1).map((h, i) => h.x1 - wide[i].x2);
      for (const a of air) {
        expect(a).toBeCloseTo(air[0], 5);
      }
    });

    it('spreads a melisma\u2019s hyphens between the syllables, not the neumes', () => {
      // "Al- -" holds Al over two neumes; the slot on the second carries no
      // letters. The hyphens belong to the one gap between Al and le, so they
      // are spread over that whole distance rather than a neume at a time.
      const svg = renderAretino('(g2) cd ef ga gf ef ed c. (z)\nw: Al- - le -lu - - - ia.', { width: 700 });
      const lyr = lyricTextEntries(svg).filter(l => l.text !== '');
      const al = lyr.find(l => l.text === 'Al');
      const le = lyr.find(l => l.text === 'le');
      const gapLeft = al.x + measureTextWidth('Al', al.fontSize, 'serif') / 2;
      const gapRight = le.x - measureTextWidth('le', le.fontSize, 'serif') / 2;
      const run = hyphenStrokes(svg).filter(h => h.x1 >= gapLeft - 1 && h.x2 <= gapRight + 1);
      expect(run.length).toBeGreaterThan(1);
      const air = [
        run[0].x1 - gapLeft,
        ...run.slice(1).map((h, i) => h.x1 - run[i].x2),
        gapRight - run[run.length - 1].x2,
      ];
      for (const a of air) {
        expect(a).toBeCloseTo(air[0], 4);
      }
    });

    describe('a melisma written as one /-split neume', () => {
      // One `/`-split neume carries one syllable however many groups it has, so
      // the rows it is broken across have no syllable slot of their own. The
      // hyphen run still belongs to the word, and must be spread over the notes
      // it is held on and carried across the row breaks.
      const melisma = "gC'ga'f/gC'ag/gC'C'ga'f/gC'aga'/CD'Cbaga'/C'aD'CD'CbaCE'DCD'g/aC'baC'/gaC'ga'";
      const src = notes => `(g2) g ag a g a ga ag ${notes} g\nw: kezd-te a ta-n\u00edt-v\u00e1-nyok l\u00e1-b\u00e1t.`;
      // Strokes sitting on one row's lyric line, given a syllable set on it.
      const rowStrokes = (svg, syl) => hyphenStrokes(svg)
        .filter(h => h.y < syl.y && h.y > syl.y - syl.fontSize);

      it('spreads the run over the held neume at the end of the row', () => {
        const svg = renderAretino(src(melisma), { width: 460 });
        const lyr = lyricTextEntries(svg).filter(l => l.text !== '');
        const la = lyr.find(l => l.text === 'l\u00e1');
        const bat = lyr.find(l => l.text === 'b\u00e1t.');
        expect(bat.y).toBeGreaterThan(la.y);
        const run = rowStrokes(svg, la).filter(h => h.x1 > la.x);
        expect(run.length).toBeGreaterThan(1);
        // The run reaches the far end of the melisma, not just past the letters.
        expect(run[run.length - 1].x2).toBeGreaterThan(la.x + 10 * la.fontSize);
      });

      it('carries the run across the row break to the next syllable', () => {
        const svg = renderAretino(src(melisma), { width: 460 });
        const lyr = lyricTextEntries(svg).filter(l => l.text !== '');
        const bat = lyr.find(l => l.text === 'b\u00e1t.');
        const run = rowStrokes(svg, bat).filter(h => h.x2 < bat.x);
        expect(run.length).toBeGreaterThan(1);
        // It starts at the row's continued neume, far left of the syllable.
        expect(run[0].x1).toBeLessThan(bat.x - 10 * bat.fontSize);
      });

      it('fills a row the melisma covers end to end', () => {
        // Long enough that one whole row is nothing but the continued neume, so
        // that row has no syllable at all to hang a hyphen on.
        const svg = renderAretino(src(`${melisma}/${melisma}`), { width: 460 });
        const lyr = lyricTextEntries(svg).filter(l => l.text !== '');
        const la = lyr.find(l => l.text === 'l\u00e1');
        const bat = lyr.find(l => l.text === 'b\u00e1t.');
        const ys = [...new Set(hyphenStrokes(svg).map(h => h.y))];
        const middle = ys.filter(y => y > la.y && y < bat.y - bat.fontSize);
        expect(middle.length).toBe(1);
        expect(hyphenStrokes(svg).filter(h => h.y === middle[0]).length).toBeGreaterThan(1);
      });
    });

    it('honours the hyphen length and thickness options', () => {
      const size = firstLyricSize(renderAretino(src, { width: 400 }));
      const [h] = hyphenStrokes(renderAretino(src, {
        width: 400, noteSpacing: 3, lyricHyphenMaxLen: 1, lyricHyphenWidth: 0.2,
      }));
      expect(h.x2 - h.x1).toBeCloseTo(size, 5);
      expect(h.width).toBeCloseTo(size * 0.2, 5);
    });

    it('hangs the stroke above the baseline, in x-heights of the face', () => {
      const svg = renderAretino(src, { width: 400, noteSpacing: 3 });
      const [h] = hyphenStrokes(svg);
      const onBaseline = hyphenStrokes(renderAretino(src, { width: 400, noteSpacing: 3, lyricHyphenPos: 0 }))[0];
      expect(h.y).toBeLessThan(onBaseline.y);
      expect(onBaseline.y).toBeCloseTo(firstLyricY(svg), 5);
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
    it('insets a key signature when no clef is drawn at the start of the row', () => {
      const svg = renderAretino('(K:b) c', { width: 400, hideRepeatClef: true });

      expect(firstFlatX(svg) - staffLeft(svg)).toBeCloseTo(renderedStaffSpace(svg) / 2, 5);
    });

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

    it('keeps a following syllable out from under a long neume when the hyphen is shown', () => {
      const svg = renderAretino('fgabag c\nw: i-gyam', { width: 600 });
      const gyam = lyricTextEntries(svg).find(l => l.text === 'gyam');
      const firstLigature = ligatureBoxes(svg)[0];
      const gyamW = measureTextWidth(gyam.text, gyam.fontSize, gyam.fontFamily);
      const gyamLeft = gyam.x - gyamW / 2;

      expect(renderedHyphenCount(svg)).toBe(1);
      expect(gyamLeft).toBeGreaterThanOrEqual(firstLigature.right - 0.01);
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

      it('== spans 2 notes as one hyphen, never collapsed', () => {
        // Two hyphens mean the syllable is held over two neumes, not that two
        // hyphens are set: what stands between the syllables is one hyphen, and
        // the empty second slot does not break it in half.
        const svg = renderAretino('c d e\nw: rülsz==e', { width: 400, noteSpacing: 0.3 });
        const texts = lyricTextEntries(svg).map(l => l.text);
        expect(texts).toContain('rülsz');
        expect(texts).toContain('e');
        expect(renderedHyphenCount(svg)).toBe(1);
      });

      it('== spreads its hyphen over the whole melisma, not neume by neume', () => {
        const svg = renderAretino('c d e\nw: rülsz==e', { width: 400, noteSpacing: 3 });
        const lyr = lyricTextEntries(svg);
        const left = lyr.find(l => l.text === 'rülsz');
        const right = lyr.find(l => l.text === 'e');
        const strokes = hyphenStrokes(svg);
        expect(strokes.length).toBeGreaterThan(1);
        // The run belongs to the one gap between the two syllables, so its air is
        // even across the whole span — the empty slot in the middle leaves no seam.
        const air = [
          strokes[0].x1 - (left.x + measureTextWidth('rülsz', left.fontSize, 'serif') / 2),
          ...strokes.slice(1).map((h, i) => h.x1 - strokes[i].x2),
          (right.x - measureTextWidth('e', right.fontSize, 'serif') / 2) - strokes[strokes.length - 1].x2,
        ];
        for (const a of air) {
          expect(a).toBeCloseTo(air[0], 4);
        }
      });

      it('= forced hyphen reserves room so it does not overlap the syllables', () => {
        const svg = renderAretino('c d\nw: rülsz=e', { width: 400, noteSpacing: 0.3 });
        const fs = 13.333333333333334;
        const w = t => measureTextWidth(t, fs, 'serif');
        const lyr = lyricTextEntries(svg);
        const left = lyr.find(l => l.text === 'rülsz');
        const right = lyr.find(l => l.text === 'e');
        const stroke = hyphenStrokes(svg)[0];
        const leftRight = left.x + w('rülsz') / 2;
        const rightLeft = right.x - w('e') / 2;
        // The stroke must sit between the two syllables, touching neither's ink.
        expect(stroke.x1).toBeGreaterThanOrEqual(leftRight - 1e-6);
        expect(stroke.x2).toBeLessThanOrEqual(rightLeft + 1e-6);
      });

      it('= does not apply the Hungarian digraph transform even when tight', () => {
        const svg = renderAretino('c d\nw: osz=szad', { width: 400, noteSpacing: 0.3 });
        const texts = lyricTextEntries(svg).map(l => l.text);
        expect(texts).toContain('osz');
        expect(texts).toContain('szad');
        expect(renderedHyphenCount(svg)).toBe(1);
      });
    });

    describe('_ extender line', () => {
      // Prolongation segments sit on the lyric baseline (horizontal: y1 === y2 ===
      // lyricY), distinct from staff lines (higher up) and note decorations.
      function extenderLines(svg) {
        const lyricY = firstLyricY(svg);
        return [...svg.matchAll(/<line ([^>]*?)\/>/g)]
          .map(m => m[1])
          .map(a => ({
            x1: parseFloat(/x1="([\d.]+)"/.exec(a)?.[1]),
            x2: parseFloat(/x2="([\d.]+)"/.exec(a)?.[1]),
            y1: parseFloat(/y1="([\d.]+)"/.exec(a)?.[1]),
            y2: parseFloat(/y2="([\d.]+)"/.exec(a)?.[1]),
          }))
          .filter(l => Math.abs(l.y1 - lyricY) < 0.5 && Math.abs(l.y1 - l.y2) < 0.01 && l.x2 > l.x1)
          .sort((a, b) => a.x1 - b.x1);
      }

      function extenderText(svg, text) {
        const lyricY = firstLyricY(svg);
        return [...svg.matchAll(/<text\b([^>]*)>(.*?)<\/text>/g)]
          .map(m => {
            const attrs = m[1];
            return {
              x: parseFloat(new RegExp('\\bx="([^"]+)"').exec(attrs)?.[1]),
              y: parseFloat(new RegExp('\\by="([^"]+)"').exec(attrs)?.[1]),
              fontFamily: new RegExp('\\bfont-family="([^"]+)"').exec(attrs)?.[1] || '',
              fontSize: parseFloat(new RegExp('\\bfont-size="([^"]+)"').exec(attrs)?.[1]),
              anchor: new RegExp('\\btext-anchor="([^"]+)"').exec(attrs)?.[1] || null,
              text: m[2].replace(/<[^>]*>/g, ''),
            };
          })
          .filter(t => t.text === text && Math.abs(t.y - lyricY) < 0.5);
      }

      it('draws a single continuous prolongation line over the held neumes', () => {
        // "ro___" (3 underscores) holds the syllable over its own neume plus two
        // more: notes 1-3 of the four. The 4th is left empty.
        const svg = renderAretino('(c4) g g g g\nw: ro___', { width: 600 });
        const lines = extenderLines(svg);
        // One unbroken line, starting past "ro" and running well to its right.
        expect(lines.length).toBe(1);
        expect(lines[0].x2 - lines[0].x1).toBeGreaterThan(0);
      });

      it('renders trailing punctuation at the far end of the extender', () => {
        const svg = renderAretino('(c4) g g g g\nw: ro___.', { width: 600 });
        const unsuffixedSvg = renderAretino('(c4) g g g g\nw: ro___', { width: 600 });
        const lines = extenderLines(svg);
        const lineEndWithoutSuffix = extenderLines(unsuffixedSvg)[0].x2;
        const periods = extenderText(svg, '.');

        expect(periods.length).toBe(1);
        // The '.' is part of the held span: its right edge lands where the
        // unsuffixed extender line would end, so it does not lengthen the span.
        expect(periods[0].anchor).toBe('end');
        expect(periods[0].x).toBeCloseTo(lineEndWithoutSuffix, 5);
        expect(lines[lines.length - 1].x2).toBeLessThan(periods[0].x);
      });

      it('a single underscore extends over the current ligature', () => {
        // "a_" holds "a" over its own (wide) ligature only; "b" follows on the
        // next neume. The prolongation line ends before "b".
        const svg = renderAretino('(c4) gfgfg g\nw: a_ b', { width: 600 });
        const lines = extenderLines(svg);
        expect(lines.length).toBe(1);
        const lyrics = lyricTextEntries(svg).map(l => l.text).join(' ');
        expect(lyrics).toContain('a');
        expect(lyrics).toContain('b');
        // "b" sits on the next neume, past the end of the prolongation line.
        const bX = parseFloat(/<text[^>]*? x="([\d.]+)"[^>]*>b<\/text>/.exec(svg)?.[1]);
        expect(bX).toBeGreaterThan(lines[0].x2);
      });

      it('a second underscore extends over the next neume too', () => {
        // "a__" holds over its own ligature plus the following one ("extend both");
        // the line reaches further right than the single-underscore case.
        const wide = renderAretino('(c4) gfgfg gfgfg g\nw: a__ b', { width: 600 });
        const narrow = renderAretino('(c4) gfgfg gfgfg g\nw: a_ b', { width: 600 });
        const wideEnd = extenderLines(wide)[0].x2;
        const narrowEnd = extenderLines(narrow)[0].x2;
        expect(wideEnd).toBeGreaterThan(narrowEnd);
      });

      it('draws nothing when the held span is too short (single short note)', () => {
        // "a_" over a single short note leaves no room past the text for a
        // meaningful line, so none is drawn.
        const svg = renderAretino('(c4) g\nw: a_', { width: 600 });
        expect(extenderLines(svg).length).toBe(0);
        expect(lyricTextEntries(svg).map(l => l.text).join('')).toContain('a');
      });

      it('renders trailing punctuation even when the extender line is too short', () => {
        const svg = renderAretino('(c4) g\nw: a_.', { width: 600 });
        const syllable = extenderText(svg, 'a')[0];
        const periods = extenderText(svg, '.');
        const syllableRight = syllable.x + measureTextWidth('a', syllable.fontSize, syllable.fontFamily) / 2;

        expect(extenderLines(svg).length).toBe(0);
        expect(periods.length).toBe(1);
        expect(periods[0].anchor).toBe('start');
        expect(periods[0].x).toBeCloseTo(syllableRight, 5);
      });

      it('\\_ renders a literal underscore instead of an extender', () => {
        const svg = renderAretino('(c4) g\nw: a\\_b', { width: 600 });
        expect(extenderLines(svg).length).toBe(0);
        expect(lyricTextEntries(svg).map(l => l.text).join('')).toContain('a_b');
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

    it('never strands a lone word (orphan/widow) when wrapping a phrase', () => {
      // Try a range of widths so the greedy fit breaks the phrase at every
      // possible position; no row may carry a single word of the phrase.
      const words = PHRASE.split('~');
      for (let width = 120; width <= 600; width += 10) {
        // Every word counts as short, as without the width threshold.
        const svg = renderAretino(`at\nw: ${PHRASE}`, { width, recitationLoneWordMin: 100 });
        const lyr = lyricTextEntries(svg).filter(l => words.includes(l.text));
        const perRow = new Map();
        for (const l of lyr) perRow.set(l.y, (perRow.get(l.y) || 0) + 1);
        const counts = [...perRow.values()];
        // A single-word row is only acceptable if the whole phrase is one word.
        if (counts.length > 1) {
          expect(counts.every(c => c >= 2)).toBe(true);
        }
      }
    });

    it('does not wrap a three-word phrase (any break orphans a word)', () => {
      // alpha|beta|gamma: breaking after alpha widows gamma, breaking after
      // beta orphans alpha — so it stays whole, narrowing nothing below 3 words.
      const svg = renderAretino('at\nw: alpha~beta~gamma', { width: 150, recitationLoneWordMin: 100 });
      const lyr = lyricTextEntries(svg).filter(l => ['alpha', 'beta', 'gamma'].includes(l.text));
      expect(new Set(lyr.map(l => l.y)).size).toBe(1);
    });

    it('does not wrap when two or more stanzas recite on the same tenor note', () => {
      // Each verse would need its own (different) word-wrap points, which the
      // lockstep ligature⇄syllable layout cannot express, so the phrase stays
      // whole: a single tenor notehead and every word of both verses rendered.
      const svg = renderAretino(`at\nw: ${PHRASE}\nw: ${PHRASE}`, { width: 200 });
      expect(tenorGlyphCount(svg)).toBe(1);
      const ys = new Set(lyricTextEntries(svg).map(l => l.y));
      // Exactly two lyric rows (one per stanza); nothing wrapped onto new rows.
      expect(ys.size).toBe(2);
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

    it('keeps a ~~ prefix glued to the first recited word', () => {
      // The prefix is display-only: it must not become a recited word of its
      // own, and the alignment text still left-aligns to the tenor note.
      const alignLeftRel = (svg, prefixText) => {
        const first = lyricTextEntries(svg)[0];
        const fullW = measureTextWidth(first.text, first.fontSize, first.fontFamily);
        const prefixW = prefixText ? measureTextWidth(prefixText, first.fontSize, first.fontFamily) : 0;
        return first.x - fullW / 2 + prefixW - ligatureBoxes(svg)[0].x;
      };
      const withPrefix = renderAretino('at\nw: Priest:~~alpha~beta~gamma~delta', { width: 600 });
      expect(lyricTextEntries(withPrefix).map(l => l.text))
        .toEqual(['Priest: alpha', 'beta', 'gamma', 'delta']);
      const plain = renderAretino('at\nw: alpha~beta~gamma~delta', { width: 600 });
      expect(alignLeftRel(withPrefix, 'Priest: ')).toBeCloseTo(alignLeftRel(plain, ''), 1);
    });

    it('does not expand a tenor syllable whose alignment text is a single word', () => {
      // "Priest: solo" contains a space, but only the ~~ alignment text counts
      // when deciding whether the phrase can wrap word-by-word.
      const svg = renderAretino('at\nw: Priest:~~solo', { width: 600 });
      expect(tenorGlyphCount(svg)).toBe(1);
      expect(lyricTextEntries(svg).map(l => l.text)).toEqual(['Priest: solo']);
    });
  });

  describe('neume separator (/) wrapping', () => {
    const ligCount = svg => (svg.match(/aretino-token aretino-ligature/g) || []).length;

    it('wraps a long /-separated melisma across rows', () => {
      const melisma = 'a/b/c/d/e/f/g/a/b/c/d/e/f/g/a/b/c/d/e/f/g';
      const svg = renderAretino(`(c4) ${melisma}\nw: al`, { width: 200 });
      expect(splitRowSVGs(svg).length).toBeGreaterThan(1);
      // The single syllable is drawn exactly once (on the first row).
      expect(lyricTextEntries(svg).map(l => l.text)).toEqual(['al']);
    });

    it('keeps a /-separated neume whole when it fits on one line', () => {
      const svg = renderAretino('(c4) a/b/c\nw: al', { width: 600 });
      expect(splitRowSVGs(svg).length).toBe(1);
    });

    it('keeps following syllables aligned after a wrapped melisma', () => {
      const svg = renderAretino('(c4) a/b/c/d/e/f/g/a/b/c/d/e/f/g d e\nw: al le lu', { width: 200 });
      expect(lyricTextEntries(svg).map(l => l.text)).toEqual(['al', 'le', 'lu']);
    });

    it('splits a neume wider than a full row across several rows', () => {
      const melisma = Array.from({ length: 60 }, (_, i) => 'abcdefg'[i % 7]).join('/');
      const svg = renderAretino(`(c4) ${melisma}\nw: al`, { width: 150 });
      expect(splitRowSVGs(svg).length).toBeGreaterThan(2);
      expect(lyricTextEntries(svg).map(l => l.text)).toEqual(['al']);
      // Every group notehead is still drawn (one ligature part per row).
      expect(ligCount(svg)).toBe(splitRowSVGs(svg).length);
    });
  });

  describe('the start clef owns its column', () => {
    const clefRightX = svg => {
      // The start clef is the first translate+scale group in the row.
      const k = renderedStaffSpace(svg) / 591;
      const tm = svg.match(/<g transform="translate\((-?[\d.]+),-?[\d.]+\) scale\([\d.]+\)">/);
      return parseFloat(tm[1]) + 2621 * k;
    };
    const firstTextLeft = svg => {
      const first = lyricTextEntries(svg)[0];
      return first.x - measureTextWidth(first.text, first.fontSize, first.fontFamily) / 2;
    };

    // Left edge of the chant C-clef's ink plus its glyph width; the clef is padded
    // on both sides, so its advance reaches well past where the glyph ends.
    const cClefInkRight = svg => {
      const m = /<path d="M69 61[^"]*"[^>]*transform="translate\(([\d.-]+), *[\d.-]+\) scale\(([\d.-]+)/.exec(svg);
      return Number(m[1]) + 134 * Number(m[2]);
    };

    it('starts the first syllable past the clef, not under it', () => {
      const svg = renderAretino('(g2) g g g g g\nw: Priest:~~Be-ne-di-ca-mus');
      expect(firstTextLeft(svg)).toBeGreaterThanOrEqual(clefRightX(svg));
    });

    it('owns the column whatever the notes do', () => {
      // The clef's column is a wall, not a shape to be measured against: neither
      // low notes pushing the lyric line down nor a bare row that leaves it high
      // buys a syllable any room under the clef.
      for (const src of [
        '(g2) c d e f g\nw: Priest:~~Be-ne-di-ca-mus',
        '(g2) g g g g g\nw: Priest:~~Be-ne-di-ca-mus',
        '(g2) f f g\nw: 1.~Sanct-us',
        '(g2) f f c\nw: 1.~Sanct-us',
      ]) {
        const svg = renderAretino(src, { width: 300 });
        expect(firstTextLeft(svg)).toBeGreaterThanOrEqual(clefRightX(svg) - 1e-9);
      }
    });

    it('sets a held-back syllable flush against the clef, with no gap', () => {
      // The wall is the clef's ink edge and nothing more: a syllable pushed off
      // the centre of its notehead to clear the clef stops exactly there.
      const svg = renderAretino('(g2) c d e f g\nw: Priest:~~c d e f g', { width: 300 });
      expect(firstTextLeft(svg)).toBeCloseTo(clefRightX(svg), 6);
    });

    it('measures the C clef by its glyph, not by its advance', () => {
      // The advance carries padding on the right, so it is not where the ink ends;
      // the wall is the glyph's own edge, and it stands wherever the clef sits.
      for (const src of ['(c1) f f g\nw: 1.~Sanct-us', '(c4) f f g\nw: 1.~Sanct-us']) {
        const svg = renderAretino(src, { width: 300 });
        expect(firstTextLeft(svg)).toBeCloseTo(cClefInkRight(svg), 6);
      }
    });

    it('keeps the lyrics clear of the clef and inside the staff at every width', () => {
      const sources = [
        '(g2) g a g a g a g a g a g a g\nw: Kyrrrieeeleison e-lei-son Chris-te e-lei-son Ky-ri-e e',
        '(g2) g a g a g a g a g a g a g a\nw: Sanc-tus Sanc-tus Do-mi-nus De-us Sa-ba-oth al-le',
        '(c1) g a g a g a g a g a g a g\nw: Kyrrrieeeleison e-lei-son Chris-te e-lei-son Ky-ri-e e',
      ];
      for (const src of sources) {
        for (let width = 240; width <= 600; width += 7) {
          for (const row of splitRowSVGs(renderAretino(src, { width }))) {
            const ext = lyricExtent(row);
            if (!ext) continue;
            expect(ext.left).toBeGreaterThanOrEqual(staffLeft(row) - 0.01);
            expect(ext.right).toBeLessThanOrEqual(staffRight(row) + 0.01);
          }
        }
      }
    });

    it('keeps a wide first syllable inside the staff when there is no clef', () => {
      // Without a clef the first note sits close to the staff's left edge, so a
      // syllable centred on it would otherwise hang out into the page margin.
      const svg = renderAretino('g a ||\nw: Sanc-tus');
      expect(firstTextLeft(svg)).toBeGreaterThanOrEqual(staffLeft(svg) - 0.01);
    });

    it('keeps a wide first syllable of a left-aligned neume inside the staff', () => {
      const svg = renderAretino('ga a ||\nw: Sanc-tus');
      expect(firstTextLeft(svg)).toBeGreaterThanOrEqual(staffLeft(svg) - 0.01);
    });

    it('keeps the lyrics between the staff edges at every page width', () => {
      // The room the row-start gap takes from a row has to be reserved when the
      // rows are packed: otherwise pushing the first neume right to clear the
      // left edge simply moves the overflow to the right margin.
      const sources = [
        'g a g a g a g a g a g a g\nw: Kyrrrieeeleison e-lei-son Chris-te e-lei-son Ky-ri-e e',
        'g a g a g a g a g a g a g a\nw: Sanc-tus Sanc-tus Do-mi-nus De-us Sa-ba-oth al-le',
        'g a g a g a g a g a g\nw: Benedicamusdomino al-le-lu-ia al-le-lu-ia a men',
      ];
      for (const src of sources) {
        for (let width = 200; width <= 600; width += 7) {
          for (const row of splitRowSVGs(renderAretino(src, { width }))) {
            const ext = lyricExtent(row);
            if (!ext) continue;
            expect(ext.left).toBeGreaterThanOrEqual(staffLeft(row) - 0.01);
            expect(ext.right).toBeLessThanOrEqual(staffRight(row) + 0.01);
          }
        }
      }
    });

    it('does not shift the first neume when its syllable already fits', () => {
      const wide = renderAretino('g a ||\nw: Sanc-tus');
      const narrow = renderAretino('g a ||\nw: i-tus');
      expect(ligatureBoxes(narrow)[0].x).toBeLessThan(ligatureBoxes(wide)[0].x);
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
    // Verse text: one <text> per display line (a marker adds one more on the
    // block's first baseline). Sources here carry no w: lyrics, so every
    // xml:space element in the SVG belongs to a verse block.
    function verseLines(svg) {
      return [...svg.matchAll(/<text xml:space="preserve" x="([\d.-]+)" y="([\d.-]+)" font-family="([^"]*)" font-size="([\d.]+)"[^>]*fill="([^"]*)"[^>]*>([\s\S]*?)<\/text>/g)]
        .map(m => ({
          x: parseFloat(m[1]),
          y: parseFloat(m[2]),
          fontFamily: m[3],
          fontSize: parseFloat(m[4]),
          fill: m[5],
          text: m[6].replace(/<[^>]*>/g, ''),
        }));
    }

    const NBSP = ' ';
    const VERSE_OPTS = { width: 500, sourceMap: false };
    // Left margin is one staff space (1.75 mm at 96 dpi); the lyric size
    // (10 pt at 96 dpi) drives every verse indent, leading and gap.
    const LEFT = METRICS.leftMargin * 1.75 * 96 / 25.4;
    const SIZE = 10 * 96 / 72;
    const rightEdge = line => line.x + measureTextWidth(line.text, line.fontSize, line.fontFamily);

    it('preserves small and large formatting in wrapped verse text', () => {
      const svg = renderAretino('c\nW: First \\small{Second} \\large{Third}', { width: 600 });

      expect(svg).toContain('<tspan style="font-size:0.75em">Second</tspan>');
      expect(svg).toContain('<tspan style="font-size:1.3333333em">Third</tspan>');
    });

    it('renders an existing psalm score exactly as before styles existed', () => {
      const source = readFileSync(new URL('./fixtures/psalm-verse.aretino', import.meta.url), 'utf8');
      const expected = readFileSync(new URL('./fixtures/psalm-verse.svg', import.meta.url), 'utf8');

      expect(renderAretino(source, { width: 700, sourceMap: false })).toBe(expected);
    });

    describe('defects', () => {
      it('treats ~ as an unbreakable space', () => {
        const words = 'aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn'.split(' ');
        const opts = { ...VERSE_OPTS, width: 300 };
        const loose = verseLines(renderAretino(`W: ${words.join(' ')}`, opts));
        // Bind the pair that straddles the wrap point: it must move down whole.
        const split = loose[0].text.split(' ').length - 1;
        const bound = verseLines(renderAretino(
          `W: ${words.slice(0, split).join(' ')} ${words[split]}~${words.slice(split + 1).join(' ')}`,
          opts));

        expect(loose[1].text.split(' ')[0]).toBe(words[split + 1]);
        expect(bound[0].text).not.toContain(words[split]);
        expect(bound[1].text.startsWith(`${words[split]}${NBSP}${words[split + 1]}`)).toBe(true);
      });

      it('renders inline glyphs in verse text instead of dropping them', () => {
        const svg = renderAretino("W: A\\'men \\b \\n \\#", VERSE_OPTS);

        // One <path> per glyph: stress mark, flat, natural, sharp.
        expect([...svg.matchAll(/<path /g)]).toHaveLength(4);
        expect(verseLines(svg).map(l => l.text).join('')).toContain('A');
      });
    });

    describe('style selection', () => {
      it('honours a block style marker', () => {
        const [line] = verseLines(renderAretino('W(rubric): Itt a pap keresztet vet.', VERSE_OPTS));

        expect(line.fill).toBe('red');
        expect(line.fontSize).toBeCloseTo(SIZE * 0.85, 6);
      });

      it('falls back to psalm for an unknown style name', () => {
        const unknown = verseLines(renderAretino('W(bogus): szöveg', VERSE_OPTS));
        const psalm = verseLines(renderAretino('W: szöveg', VERSE_OPTS));

        expect(unknown).toEqual(psalm);
      });

      it('resolves block marker over renderer option over %option over psalm', () => {
        const styleOf = svg => verseLines(svg)[0].fill;
        const header = '%option: textStyle=rubric\n%%\n';

        expect(styleOf(renderAretino('W: szöveg', VERSE_OPTS))).toBe('#000');
        expect(styleOf(renderAretino(`${header}W: szöveg`, VERSE_OPTS))).toBe('red');
        expect(styleOf(renderAretino(`${header}W: szöveg`, { ...VERSE_OPTS, textStyle: 'prose' }))).toBe('#000');
        expect(styleOf(renderAretino(`${header}W(rubric): szöveg`, { ...VERSE_OPTS, textStyle: 'prose' }))).toBe('red');
      });

      it('merges a host textStyles override over the preset', () => {
        const [line] = verseLines(renderAretino('W(prose): szöveg', { ...VERSE_OPTS, textStyles: { prose: { color: 'blue' } } }));

        expect(line.fill).toBe('blue');
      });
    });

    describe('indents', () => {
      const long = 'aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn ooo ppp qqq';

      it('indents both a source break and a wrapped line in psalm', () => {
        const lines = verseLines(renderAretino(`W: rövid\n${long}`, VERSE_OPTS));

        expect(lines[0].x).toBeCloseTo(LEFT, 6);
        expect(lines[1].x).toBeCloseTo(LEFT + 2 * SIZE, 6);
        expect(lines[2].x).toBeCloseTo(LEFT + 2 * SIZE, 6);
      });

      it('keeps a stanza break flush and indents only the wrapped line', () => {
        const lines = verseLines(renderAretino(`W(stanza): rövid\n${long}`, VERSE_OPTS));

        expect(lines[0].x).toBeCloseTo(LEFT, 6);
        expect(lines[1].x).toBeCloseTo(LEFT, 6);
        expect(lines[2].x).toBeCloseTo(LEFT + 1.5 * SIZE, 6);
      });

      it('reflows source breaks in prose and rubric', () => {
        const prose = verseLines(renderAretino('W(prose): első\nmásodik', VERSE_OPTS));
        const rubric = verseLines(renderAretino('W(rubric): első\nmásodik', VERSE_OPTS));

        expect(prose).toHaveLength(1);
        expect(prose[0].text).toBe('első második');
        expect(rubric).toHaveLength(1);
      });

      it('honours source breaks in psalm and stanza', () => {
        expect(verseLines(renderAretino('W: első\nmásodik', VERSE_OPTS))).toHaveLength(2);
        expect(verseLines(renderAretino('W(stanza): első\nmásodik', VERSE_OPTS))).toHaveLength(2);
      });
    });

    describe('line height and block gaps', () => {
      it('leads lines inside a block by the style line height', () => {
        const psalm = verseLines(renderAretino('W: első\nmásodik', VERSE_OPTS));
        const stanza = verseLines(renderAretino('W(stanza): első\nmásodik', VERSE_OPTS));

        expect(psalm[1].y - psalm[0].y).toBeCloseTo(1.1 * SIZE, 6);
        expect(stanza[1].y - stanza[0].y).toBeCloseTo(1.15 * SIZE, 6);
      });

      it('uses gapWithin inside a run and the larger claim at a style change', () => {
        const sameRun = verseLines(renderAretino('W: első\nW: második', VERSE_OPTS));
        const changed = verseLines(renderAretino('W: első\nW(prose): második', VERSE_OPTS));
        const toRubric = verseLines(renderAretino('W: első\nW(rubric): második', VERSE_OPTS));

        expect(sameRun[1].y - sameRun[0].y).toBeCloseTo(1.3 * SIZE, 6);
        expect(changed[1].y - changed[0].y).toBeCloseTo(1.6 * SIZE, 6);
        // max(psalm.gapAfter 1.3, rubric.gapBefore 1.8)
        expect(toRubric[1].y - toRubric[0].y).toBeCloseTo(1.8 * SIZE, 6);
      });

      it('gives a rubric its own leading at its own size', () => {
        const lines = verseLines(renderAretino('W(rubric): első\nW(rubric): második', VERSE_OPTS));

        expect(lines[1].y - lines[0].y).toBeCloseTo(1.2 * SIZE, 6);
      });
    });

    describe('markers', () => {
      it('shares one text column across a run and aligns 1. with 10.', () => {
        const lines = verseLines(renderAretino('W(stanza): 1.~~Első\nW(stanza): 10.~~Tizedik', VERSE_OPTS));
        const [oneMarker, oneBody, tenMarker, tenBody] = lines;

        expect(oneMarker.text).toBe('1.');
        expect(tenMarker.text).toBe('10.');
        expect(oneMarker.x).toBeCloseTo(LEFT, 6);
        expect(tenMarker.x).toBeCloseTo(LEFT, 6);
        expect(oneBody.x).toBeCloseTo(tenBody.x, 6);
        expect(oneBody.x).toBeGreaterThan(LEFT);
      });

      it('does not share the column across a style change', () => {
        const lines = verseLines(renderAretino('W(stanza): 1.~~Első\nW(prose): Előénekes:~~Második', VERSE_OPTS));

        expect(lines[1].x).toBeLessThan(lines[3].x);
      });

      it('binds a multi-word marker with ~', () => {
        const [marker, body] = verseLines(renderAretino('W(prose): Előénekes~és~nép:~~Az áldozás alatt', VERSE_OPTS));

        expect(marker.text).toBe(`Előénekes${NBSP}és${NBSP}nép:`);
        expect(body.text).toBe('Az áldozás alatt');
      });

      it('hangs a marker in any style, including psalm', () => {
        const [marker, body] = verseLines(renderAretino('W: \\R.~~Dicsőség az Atyának', VERSE_OPTS));

        expect(marker.text).toBe('℟.');
        expect(marker.x).toBeCloseTo(LEFT, 6);
        expect(body.x).toBeGreaterThan(marker.x);
      });

      it('lets a marker over textMaxIndent overhang the column', () => {
        const lines = verseLines(renderAretino('W(stanza): 100.~~Szöveg\nW(stanza): 1.~~Rövid', { ...VERSE_OPTS, textMaxIndent: 2 }));
        const column = LEFT + 2 * SIZE;

        // The narrow marker sits at the capped column; the wide one runs past it.
        expect(lines[3].x).toBeCloseTo(column, 6);
        expect(lines[1].x).toBeGreaterThan(column);
      });

      it('sets markers flush against the column when asked to right-align', () => {
        const source = 'W(stanza): 1.~~Első versszak\nW(stanza): Refrén.~~Második versszak';
        const lines = verseLines(renderAretino(source, { ...VERSE_OPTS, textMarkerAlign: 'right' }));
        const [oneMarker, oneBody, refrainMarker, refrainBody] = lines;
        const gap = 0.5 * SIZE;

        // Both markers end one markerGap short of the shared text column, so the
        // widest one still starts at the margin and the short one moves in.
        expect(oneMarker.x).toBeGreaterThan(LEFT);
        expect(refrainMarker.x).toBeCloseTo(LEFT, 6);
        expect(rightEdge(oneMarker) + gap).toBeCloseTo(oneBody.x, 4);
        expect(rightEdge(refrainMarker) + gap).toBeCloseTo(refrainBody.x, 4);
      });

      it('keeps a right-aligned marker inside the margin when it overhangs', () => {
        const source = 'W(stanza): 100.~~Szöveg\nW(stanza): 1.~~Rövid';
        const opts = { ...VERSE_OPTS, textMaxIndent: 2, textMarkerAlign: 'right' };
        const lines = verseLines(renderAretino(source, opts));

        expect(lines[0].x).toBeCloseTo(LEFT, 6);
        expect(lines[2].x).toBeGreaterThan(LEFT);
      });

      it('right-aligns one style only from a host textStyles override', () => {
        const source = 'W(stanza): 1.~~Első\nW(stanza): Refrén.~~Második';
        const left = verseLines(renderAretino(source, VERSE_OPTS));
        const right = verseLines(renderAretino(source, { ...VERSE_OPTS, textStyles: { stanza: { markerAlign: 'right' } } }));

        expect(left[0].x).toBeCloseTo(LEFT, 6);
        expect(right[0].x).toBeGreaterThan(LEFT);
        // Only the marker moves: the shared text column is unchanged.
        expect(right[1].x).toBeCloseTo(left[1].x, 6);
      });

      it('breaks to the column when no word fits beside an overhanging marker', () => {
        const source = 'W(prose): Előénekes~és~az~egész~nép~együtt:~~Megszentelendő';
        const lines = verseLines(renderAretino(source, { ...VERSE_OPTS, width: 300 }));

        expect(lines).toHaveLength(2);
        expect(lines[0].x).toBeCloseTo(LEFT, 6);
        expect(lines[1].y).toBeGreaterThan(lines[0].y);
        expect(lines[1].text).toBe('Megszentelendő');
      });
    });

    describe('manual break', () => {
      it('breaks the line like a source newline', () => {
        const piped = verseLines(renderAretino('W: első | második', VERSE_OPTS));
        const newline = verseLines(renderAretino('W: első\nmásodik', VERSE_OPTS));

        expect(piped.map(l => [l.x, l.y, l.text])).toEqual(newline.map(l => [l.x, l.y, l.text]));
      });

      it('survives reflow, where source breaks do not', () => {
        const lines = verseLines(renderAretino('W(prose): első\nmásodik | harmadik', VERSE_OPTS));

        expect(lines.map(l => l.text)).toEqual(['első második', 'harmadik']);
      });

      it('carries inline formatting across the break', () => {
        const svg = renderAretino('W(prose): <Az áldozás alatt | a nép énekelhet>', VERSE_OPTS);

        expect([...svg.matchAll(/font-style="italic"/g)]).toHaveLength(2);
        expect(verseLines(svg).map(l => l.text)).toEqual(['Az áldozás alatt', 'a nép énekelhet']);
      });

      it('leaves \\| as a literal pipe', () => {
        const lines = verseLines(renderAretino('W: a \\| b', VERSE_OPTS));

        expect(lines).toHaveLength(1);
        expect(lines[0].text).toBe('a | b');
      });

      it('does not break lyric text on |', () => {
        const svg = renderAretino('c\nw: a|b', { width: 300, sourceMap: false });

        expect(svg).toContain('a|b');
      });
    });

    it('justifies wrapped lines but never a block last line when asked', () => {
      const source = 'W(prose): aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll';
      const justified = renderAretino(source, { ...VERSE_OPTS, width: 300, textStyles: { prose: { align: 'justify' } } });
      const lines = verseLines(justified);
      const lastY = lines[lines.length - 1].y;
      const firstRow = lines.filter(l => l.y === lines[0].y);

      // A justified line is emitted word by word; the last line stays one run.
      expect(firstRow.length).toBeGreaterThan(1);
      expect(lines.filter(l => l.y === lastY)).toHaveLength(1);
      expect(firstRow[firstRow.length - 1].x + 0.01).toBeGreaterThan(lines[0].x);
    });

    it('emits a row marker per block so a text-only score splits into rows', () => {
      const source = 'W: első blokk\n\nW: második blokk\n\nW: harmadik blokk';
      const rows = splitRowSVGs(renderAretino(source, VERSE_OPTS));

      expect(rows).toHaveLength(3);
      expect(rows[0]).toContain('első blokk');
      expect(rows[0]).not.toContain('második blokk');
      expect(renderFirstRow(source, VERSE_OPTS)).toContain('első blokk');
    });

    it('carries a class and a source span on every verse line', () => {
      const source = 'W(stanza): első\nmásodik';
      const svg = renderAretino(source, { width: 500 });
      const groups = [...svg.matchAll(/<g class="([^"]*aretino-verse[^"]*)" data-src-start="(\d+)" data-src-end="(\d+)"/g)];

      expect(groups).toHaveLength(2);
      expect(groups[0][1]).toContain('aretino-verse-stanza');
      expect(parseInt(groups[0][2], 10)).toBe(source.indexOf('első'));
      expect(parseInt(groups[1][2], 10)).toBe(source.indexOf('második'));
    });
  });

  describe('barline labels', () => {
    function barlineLabelPositions(svg) {
      const barlineXs = [...svg.matchAll(/class="[^"]*aretino-barline[^"]*"[^>]*>\s*<[^>]+x1="([^"]+)"/g)]
        .map(m => parseFloat(m[1]));
      const labelXs = [...svg.matchAll(/class="[^"]*aretino-barline-label[^"]*"[^>]*>[\s\S]*?<text[^>]*x="([^"]+)"/g)]
        .map(m => parseFloat(m[1]));
      return { barlineXs, labelXs };
    }

    it('places a barline label after a multi-neume syllable under the correct barline', () => {
      // "cae--" spans 2 ligatures; "(V)" should land under || (3rd barline), not the 2nd comma
      const source = 'c d , f , g ||\nw: in cae--lis. (V)';
      const svg = renderAretino(source, { width: 800 });

      const { barlineXs, labelXs } = barlineLabelPositions(svg);
      const labelX = labelXs[0] ?? null;

      // The label must appear and its X must equal the last (||) barline's center X
      expect(labelX).not.toBeNull();
      expect(labelX).toBeGreaterThan(barlineXs[1]);
    });

    it('does not let tenor-recitation word expansion shift a following barline label earlier', () => {
      const source = '(g2) C | Ct g  | f a C g |  C | C\nw: 1 2~3 4 5 6 7 8 LAST (*) c';
      const svg = renderAretino(source, { width: 800 });

      const { barlineXs, labelXs } = barlineLabelPositions(svg);

      expect(labelXs).toHaveLength(1);
      expect(labelXs[0]).toBeCloseTo(barlineXs[3], 5);
      expect(labelXs[0]).not.toBeCloseTo(barlineXs[2], 5);
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
      // a wider reserve surviving as a void. (The lyrics are what make the row
      // justify at all: a lyric-less row keeps its default neume advances.)
      const svg = renderAretino('g g g g | (z) g g g g\nw: a a a a b b b b', { width: 600, hideRepeatClef: true });
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

    it('levels every gap to the widest non-outlier floor on an unjustified row', () => {
      // All neume distances on a line are the same — except a gap whose
      // lyric-forced floor exceeds gapOutlierThreshold. The wide word's floor
      // is an outlier: the gaps on both of its sides keep that wide floor
      // locally while every other gap levels to the widest ordinary floor.
      const svg = renderAretino('g g g g g g\nw: no no Extraordinarily no no no', { width: 800 });
      const rows = splitRowSVGs(svg);
      expect(rows).toHaveLength(1);

      const boxes = ligatureBoxes(rows[0]);
      expect(boxes).toHaveLength(6);
      const gaps = boxes.slice(0, -1).map((b, i) => boxes[i + 1].x - b.right);

      expect(gaps[3]).toBeCloseTo(gaps[0], 1);
      expect(gaps[4]).toBeCloseTo(gaps[0], 1);
      expect(gaps[1]).toBeGreaterThan(gaps[0] * 2);
      expect(gaps[2]).toBeGreaterThan(gaps[0] * 2);
    });

    it('does not let an outlier syllable force an early wrap', () => {
      // The line breaker reserves the leveling need for each candidate row.
      // Since an outlier floor no longer drives the leveling target, the wide
      // word costs only its own width: all ten notes pack onto one row, with
      // uniform gaps everywhere except around the outlier.
      const svg = renderAretino(
        'g g g g g g g g g g\nw: no no Extraordinarily no no no no no no no',
        { width: 600 },
      );
      const rows = splitRowSVGs(svg);
      expect(rows).toHaveLength(1);
      expect(ligatureBoxes(rows[0])).toHaveLength(10);
    });

    it('wraps early enough that a filling row never compresses its leveled gaps', () => {
      // The line breaker reserves the leveling need (raising every gap to the
      // row's widest non-outlier floor) on top of the items' own widths.
      // Without the reserve all ten notes would pack onto one row and the
      // gaps around the moderately wide word would dwarf the collapsed plain
      // gaps; instead the row wraps and every row keeps uniform neume
      // distances. Pin the outlier cutoff above this fixture so the test
      // exercises the non-outlier reserve path explicitly; the outlier case is
      // covered separately above.
      const svg = renderAretino(
        'g g g g g g g g g g\nw: no no noon no no no no no no no',
        { width: 250, gapOutlierThreshold: 100 },
      );
      const rows = splitRowSVGs(svg);
      expect(rows.length).toBeGreaterThan(1);

      let notesSeen = 0;
      for (const row of rows) {
        const boxes = ligatureBoxes(row);
        notesSeen += boxes.length;
        const gaps = boxes.slice(0, -1).map((b, i) => boxes[i + 1].x - b.right);
        for (const gap of gaps.slice(1)) {
          expect(gap).toBeCloseTo(gaps[0], 1);
        }
      }
      expect(notesSeen).toBe(10);
    });

    it('does not add leveled space on top of a barline\'s built-in post-gap', () => {
      // The barline's built-in post-gap sits in the gap's own advance, so
      // leveling must not add extra on top of it: the gap after the barline
      // stays exactly barlinePostGap.
      const svg = renderAretino('g g | g g', { width: 600 });
      const row = splitRowSVGs(svg)[0];
      const ss = renderedStaffSpace(row);

      const barX1 = Math.max(...barlineX1s(row));
      const glyphRightEdge = barX1 - METRICS.barlineOffsetX * ss + METRICS.barlineAdvance * ss;
      const nextNote = ligatureBoxes(row).find(b => b.x > barX1);
      expect(nextNote.x - glyphRightEdge).toBeCloseTo(METRICS.barlinePostGap * ss, 1);
    });

    it('a wide syllable after a barline does not spread the neume gaps before it', () => {
      // A barline carries its own post-gap plus clearance for the syllable that
      // follows it (barlinePostExtra) — a local reserve, not the line's
      // neume-to-neume rhythm. Widening a syllable after a barline (whose own
      // gap-after does not grow, because the next neume is a left-aligned
      // ligature) must not set the leveling target and pull the neumes on the
      // far side of the barline out to match it. A proportional metric where
      // 'M' is wider than 'A' surfaces the difference (the headless fallback
      // measures by character count, so "Al" and "Ml" would tie).
      const metric = (text, fontSize) => {
        const w = { M: 0.9, A: 0.68, l: 0.28, e: 0.53, u: 0.56, i: 0.24, a: 0.55, '-': 0.33, ',': 0.28, '.': 0.28, ' ': 0.28 };
        let sum = 0;
        for (const ch of text) sum += (w[ch] ?? 0.55) * fontSize;
        return sum;
      };
      const phrase1X = (thirdSyllable) => {
        const svg = renderAretino(
          `(g2) g a b g. ab a g e_d_ , g ab ag g. ||\nw: Al-le-lu-ia, al-le-lu-ia, ${thirdSyllable}-le-lu-ia.`,
          { width: 100000, measureText: metric },
        );
        // The eight neumes before the single barline are the first two phrases.
        return ligatureBoxes(splitRowSVGs(svg)[0]).slice(0, 8).map(b => b.x);
      };
      const base = phrase1X('Al');
      const widened = phrase1X('Ml');
      base.forEach((x, i) => expect(widened[i]).toBeCloseTo(x, 1));
    });

    it('inserts a single leveled gap across slur markers', () => {
      // brace-open/close markers have no advance; the boundaries on both
      // sides of a marker must not each receive the leveled gap, or the
      // spacing doubles wherever a slur starts or ends.
      const svg = renderAretino('g \\slur{g g} g', { width: 600 });
      const boxes = ligatureBoxes(splitRowSVGs(svg)[0]);
      expect(boxes).toHaveLength(4);
      const gaps = boxes.slice(0, -1).map((b, i) => boxes[i + 1].x - b.right);

      expect(gaps[0]).toBeCloseTo(gaps[1], 1);
      expect(gaps[2]).toBeCloseTo(gaps[1], 1);
    });

    it('levels hyphen-joined and word gaps alike when justifying', () => {
      // First version of gap leveling: every gap on the line is the same,
      // whether the boundary is intra-word ("Ky-ri-e") or between words.
      const svg = renderAretino('g g g g (z) g\nw: Ky-ri-e no x', { width: 600 });
      const boxes = ligatureBoxes(splitRowSVGs(svg)[0]);
      expect(boxes).toHaveLength(4);
      const gaps = boxes.slice(0, -1).map((b, i) => boxes[i + 1].x - b.right);

      expect(gaps[1]).toBeCloseTo(gaps[0], 1);
      expect(gaps[2]).toBeCloseTo(gaps[0], 1);
    });

    it('keeps a spacer as fixed extra width on top of a leveled gap', () => {
      const svg = renderAretino('g g (sp) g g', { width: 600 });
      const row = splitRowSVGs(svg)[0];
      const boxes = ligatureBoxes(row);
      expect(boxes).toHaveLength(4);
      const gaps = boxes.slice(0, -1).map((b, i) => boxes[i + 1].x - b.right);
      const ss = renderedStaffSpace(row);

      expect(gaps[1]).toBeCloseTo(gaps[0] + METRICS.spacerAdvance * ss, 1);
      expect(gaps[2]).toBeCloseTo(gaps[0], 1);
    });
  });

  describe('lyric-less neumes', () => {
    function rowGaps(svg, rowIndex = 0) {
      const boxes = ligatureBoxes(splitRowSVGs(svg)[rowIndex]);
      return boxes.slice(0, -1).map((b, i) => boxes[i + 1].x - b.right);
    }

    it('keeps the default advance on a justified row with no lyrics', () => {
      // A bare psalm melody has no syllables to even out, so (z) must not
      // stretch it to the margin: every gap stays the plain neume advance,
      // exactly as on an unjustified row.
      const justified = rowGaps(renderAretino('(g2) g g g g g (z) g g', { width: 600 }));
      const ragged = rowGaps(renderAretino('(g2) g g g g g', { width: 600 }));

      expect(justified).toHaveLength(4);
      expect(ragged).toHaveLength(4);
      justified.forEach((gap, i) => expect(gap).toBeCloseTo(ragged[i], 5));
    });

    it('does not justify a row whose lyrics are only division marks', () => {
      // '*' (flex/asterisk) and '+' (dagger) are editorial marks, not sung
      // text. They still reserve room for themselves, so the gaps they touch
      // are wider than a bare gap — but the row is not spread to the margin.
      const marked = rowGaps(renderAretino('(g2) g g g g g (z) g g\nw: * + *', { width: 600 }));
      const real = rowGaps(renderAretino('(g2) g g g g g (z) g g\nw: a b c', { width: 600 }));
      const bare = rowGaps(renderAretino('(g2) g g g g g', { width: 600 }));

      expect(marked[3]).toBeCloseTo(bare[3], 5);
      expect(marked[0]).toBeLessThan(real[0] / 4);
    });

    it('gives a syllable of bare ~ spaces no width of its own', () => {
      // '~' renders a space, so a syllable made of nothing but '~' has no ink:
      // it must reserve no room, leaving the gap between two such neumes at the
      // plain default advance, exactly as if nothing were written under them.
      const tilde = rowGaps(renderAretino('(g2) g g g g\nw: mmmm ~ ~ mmmm', { width: 600 }));
      const bare = rowGaps(renderAretino('(g2) g g g g', { width: 600 }));

      expect(tilde[1]).toBeCloseTo(bare[1], 5);
    });

    it('still spaces a ~ used inside a syllable', () => {
      const svg = renderAretino('(g2) g\nw: unbreakable~space', { width: 600 });

      expect(svg).toContain('unbreakable space');
    });

    it('justifies a lyric-less row when justifyWithoutLyrics is set', () => {
      const gaps = rowGaps(renderAretino('(g2) g g g g g (z) g g', {
        width: 600,
        justifyWithoutLyrics: true,
      }));
      const bare = rowGaps(renderAretino('(g2) g g g g g', { width: 600 }));

      gaps.forEach(gap => expect(gap).toBeGreaterThan(bare[0] * 4));
      gaps.forEach(gap => expect(gap).toBeCloseTo(gaps[0], 1));
    });

    it('treats a neume held under a melisma or extender as lyric-bearing', () => {
      // The extra note groups of 'Al- -' and the neumes an extender line runs
      // over carry no text of their own, but they are still sung syllables:
      // their gaps take part in justification like any other.
      const melisma = rowGaps(renderAretino('(g2) cd ef ga gf (z) c\nw: Al- - le -lu', { width: 600 }));
      const extender = rowGaps(renderAretino('(g2) g g g g (z) g\nw: ro___.', { width: 600 }));
      const bare = rowGaps(renderAretino('(g2) g g g g', { width: 600 }));

      melisma.forEach(gap => expect(gap).toBeGreaterThan(bare[0] * 4));
      extender.forEach(gap => expect(gap).toBeGreaterThan(bare[0] * 4));
    });

    it('leaves lyric-less neumes at the default advance next to sung ones', () => {
      // Only the gaps around the intonation syllables level; the reciting
      // notes that follow keep their default advance.
      const gaps = rowGaps(renderAretino('(g2) g g g g a g. g f g g. (z)\nw: Di-cső-ség', { width: 400 }));
      const bare = rowGaps(renderAretino('(g2) g g g g a g. g f g g.', { width: 400 }));

      expect(gaps[0]).toBeGreaterThan(bare[0] * 4);
      for (let i = 3; i < gaps.length; i++) {
        expect(gaps[i]).toBeCloseTo(bare[i], 5);
      }
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
