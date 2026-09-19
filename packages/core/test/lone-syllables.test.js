import { describe, it, expect } from 'vitest';
import { renderAretino, splitRowSVGs } from '../src/index.js';
import { METRICS } from '../src/glyphs.js';
import { measureTextWidth } from '../src/text.js';
import { parseSyllables, expandSyllablesForLigatures, lyricWords } from '../src/lyrics.js';
import { breakViolations, levelingNeed, condenseCaps, condenseGaps } from '../src/measure.js';

// --- helpers ---------------------------------------------------------------

function words(text) {
  return lyricWords(expandSyllablesForLigatures(parseSyllables(text).filter(s => s.kind === 'note')));
}

function lig(entries, extra = {}) {
  return { kind: 'ligature', lyricWord: entries, ...extra };
}

// The syllables of each rendered row, in order.
function rowSyllables(svg) {
  return splitRowSVGs(svg).map(row =>
    [...row.matchAll(/<text\b[^>]*xml:space="preserve"[^>]*>(.*?)<\/text>/g)]
      .map(m => m[1].replace(/<[^>]*>/g, '')));
}

// Rows as one string, with ' | ' at each break, for matching break patterns.
function rowsText(svg) {
  return ` ${rowSyllables(svg).map(r => r.join(' ')).join(' | ')} `;
}

function ligatureBoxes(svg) {
  return [...svg.matchAll(/<g class="aretino-token aretino-ligature"[^>]*data-bbox-x="([^"]+)" data-bbox-width="([^"]+)"/g)]
    .map(m => ({ x: Number(m[1]), right: Number(m[1]) + Number(m[2]) }));
}

// Lone syllables at the breaks of a single-stanza render, counted from the
// lyric source's own hyphenation.
function loneSyllables(svg, lyric) {
  const sylWord = [];
  for (const word of lyric.split(/\s+/)) {
    const n = word.split('-').length;
    for (let k = 1; k <= n; k++) sylWord.push({ k, n });
  }
  const rows = rowSyllables(svg);
  let seen = 0;
  let count = 0;
  for (let r = 0; r < rows.length - 1; r++) {
    seen += rows[r].length;
    const { k, n } = sylWord[seen - 1];
    if (k < n) {
      if (k === 1) count++;
      if (n - k === 1) count++;
    }
  }
  return count;
}

// A plain syllabic chant: one note per syllable.
function chant(lyric) {
  const pitches = 'gfgagfgagfgagfefgagf';
  const count = lyric.split(/[\s-]+/).length;
  const notes = Array.from({ length: count }, (_, i) => pitches[i % pitches.length]);
  return `(c4) ${notes.join(' ')}\nw: ${lyric}`;
}

const LYRIC = 'Ó Is-ten, kö-nyö-rül-je-tek raj-tunk, meg-szen-tel a-kik mi-ránk';
const SRC = chant(LYRIC);

function both(src, options) {
  return {
    off: renderAretino(src, { ...options, avoidLoneSyllables: false }),
    on: renderAretino(src, options),
  };
}

// --- scoring primitives ----------------------------------------------------

describe('lyricWords', () => {
  it('numbers the syllables of each hyphen-joined word', () => {
    expect(words('kö-nyö-rül je-tek')).toEqual([
      { word: 1, pos: 1, len: 3 }, { word: 1, pos: 2, len: 3 }, { word: 1, pos: 3, len: 3 },
      { word: 2, pos: 1, len: 2 }, { word: 2, pos: 2, len: 2 },
    ]);
  });

  it('gives melisma and extender placeholder slots the syllable before them', () => {
    expect(words('Ky--ri-e')).toEqual([
      { word: 1, pos: 1, len: 3 }, { word: 1, pos: 1, len: 3 },
      { word: 1, pos: 2, len: 3 }, { word: 1, pos: 3, len: 3 },
    ]);
    const extended = words('ro__ sa');
    expect(extended[0]).toEqual(extended[1]);
    expect(extended[2].word).not.toBe(extended[0].word);
  });

  it('leaves slots with no real lyric out of every word', () => {
    expect(words('Is-ten * + a-men').map(w => w && w.word)).toEqual([1, 1, null, null, 2, 2]);
  });
});

describe('breakViolations', () => {
  it('allows a break inside a word only at 2 ≤ b ≤ n−2', () => {
    for (let n = 1; n <= 6; n++) {
      for (let b = 1; b < n; b++) {
        const left = lig([{ word: 1, pos: b, len: n }]);
        const right = lig([{ word: 1, pos: b + 1, len: n }]);
        const expected = (b === 1 ? 1 : 0) + (n - b === 1 ? 1 : 0);
        expect(breakViolations(left, right), `n=${n} b=${b}`).toBe(expected);
      }
    }
  });

  it('does not count a break between two words', () => {
    expect(breakViolations(lig([{ word: 1, pos: 1, len: 1 }]), lig([{ word: 2, pos: 1, len: 3 }]))).toBe(0);
  });

  it('counts a split inside a melisma with the head\'s syllable', () => {
    // Inside the first syllable of three: one syllable stays before the break.
    const first = lig([{ word: 1, pos: 1, len: 3 }]);
    expect(breakViolations(first, first)).toBe(1);
    // Inside the last syllable: nothing of the word follows, so it's clean.
    const last = lig([{ word: 1, pos: 2, len: 2 }]);
    expect(breakViolations(last, last)).toBe(0);
  });

  it('adds up the violations of every stanza', () => {
    const left = lig([{ word: 1, pos: 2, len: 4 }, { word: 7, pos: 1, len: 3 }]);
    const right = lig([{ word: 1, pos: 3, len: 4 }, { word: 7, pos: 2, len: 3 }]);
    expect(breakViolations(left, right)).toBe(1);
    const bothBad = lig([{ word: 1, pos: 1, len: 2 }, { word: 7, pos: 1, len: 3 }]);
    const next = lig([{ word: 1, pos: 2, len: 2 }, { word: 7, pos: 2, len: 3 }]);
    expect(breakViolations(bothBad, next)).toBe(3);
  });

  it('ignores ligatures without words (recitation pieces, no lyrics)', () => {
    expect(breakViolations(lig(null), lig([{ word: 1, pos: 2, len: 2 }]))).toBe(0);
    expect(breakViolations(lig([null]), lig([null]))).toBe(0);
    expect(breakViolations({ kind: 'ligature' }, { kind: 'ligature' })).toBe(0);
  });
});

describe('condensing primitives', () => {
  const ctx = { staffSpace: 10, gapOutlierThreshold: 2, wrapCondenseMin: 0.75, ligatureStepAdvance: 8 };
  ctx.singleNoteAdvance = METRICS.singleNoteAdvance * ctx.staffSpace;
  const note = { pitch: 'g', modifiers: [] };
  const neume = (syllableExtra, syllableNeed, notes = 1) => ({
    kind: 'ligature', hasLyric: true, syllableExtra, syllableNeed,
    groups: [Array.from({ length: notes }, () => note)],
  });

  it('levelingNeed never decreases as the threshold grows', () => {
    const row = [neume(0, 10), neume(12, 31), neume(5, 24), neume(18, 37), neume(0, 8), neume(3, 22)];
    let prev = -1;
    for (let t = 0; t <= 3; t += 0.05) {
      const need = levelingNeed(ctx, row, t);
      expect(need).toBeGreaterThanOrEqual(prev);
      prev = need;
    }
  });

  it('never narrows a gap below its syllable need or past its cap', () => {
    const white = ctx.singleNoteAdvance - METRICS.noteBoxWidth * ctx.staffSpace;
    // The middle neume's syllable asks for exactly the room the neume takes,
    // so that gap has nothing to give.
    const row = [neume(0, 12, 3), neume(0, 30, 3), neume(4, ctx.singleNoteAdvance + 4), neume(0, 15, 2), neume(0, 10)];
    const caps = condenseCaps(ctx, row);
    for (let i = 0; i < row.length - 1; i++) {
      expect(caps[i]).toBeLessThanOrEqual(0.25 * white + 1e-9);
    }
    // A gap already set by its syllable gives nothing up.
    expect(caps[2]).toBe(0);
    const total = caps.reduce((s, c) => s + c, 0);
    const result = condenseGaps(ctx, row, total * 0.6);
    expect(result).not.toBeNull();
    expect(result.cuts.reduce((s, c) => s + c, 0)).toBeCloseTo(total * 0.6, 6);
    result.cuts.forEach((cut, i) => {
      expect(cut).toBeLessThanOrEqual(caps[i] + 1e-9);
      expect(cut).toBeLessThanOrEqual(result.delta + 1e-9);
    });
    expect(condenseGaps(ctx, row, total + 1)).toBeNull();
    expect(condenseGaps({ ...ctx, wrapCondenseMin: 1 }, row, 1)).toBeNull();
  });
});

// --- layout ------------------------------------------------------------------

describe('avoiding lone syllables at line breaks', () => {
  it('pushes a widowed syllable back onto the row (könyörülje | tek)', () => {
    const { off, on } = both(SRC, { width: 115 });
    expect(rowsText(off)).toContain(' je | tek ');
    expect(rowsText(on)).toContain(' je tek | ');
    expect(rowSyllables(on).length).toBeLessThanOrEqual(rowSyllables(off).length);
  });

  it('never leaves an orphaned first syllable (kö | nyörüljetek)', () => {
    const { off, on } = both(SRC, { width: 111 });
    expect(rowsText(off)).toContain(' kö | nyö ');
    expect(rowsText(on)).not.toMatch(/ kö \| /);
    expect(rowsText(on)).toContain(' | kö nyö rül je ');
  });

  it('keeps a three-syllable word whole when it can be condensed (megszen | tel)', () => {
    const { off, on } = both(SRC, { width: 357 });
    expect(rowsText(off)).toContain(' szen | tel ');
    expect(rowsText(on)).toContain(' meg szen tel | ');
    expect(rowSyllables(on)).toHaveLength(rowSyllables(off).length);
  });

  it('moves the whole word down when pushing is infeasible, and justifies the row it left (meg | szentel)', () => {
    const { off, on } = both(SRC, { width: 331 });
    expect(rowsText(off)).toContain(' meg | szen ');
    expect(rowsText(on)).toContain(' | meg szen tel ');
    // Justified: the neumes left on the row spread out to fill the room `meg`
    // gave up.
    const onFirst = ligatureBoxes(splitRowSVGs(on)[0]);
    const offFirst = ligatureBoxes(splitRowSVGs(off)[0]);
    expect(offFirst).toHaveLength(onFirst.length + 1);
    const last = onFirst.length - 1;
    expect(onFirst[last].right).toBeGreaterThan(offFirst[last].right + METRICS.singleNoteAdvance * renderStaffSpace(on));
  });

  it('condenses by lowering the outlier threshold without narrowing any gap (stage 1)', () => {
    const { off, on } = both(SRC, { width: 87 });
    expect(rowsText(off)).toContain(' a | kik ');
    expect(rowsText(on)).toContain(' a kik | ');
    const sp = renderStaffSpace(on);
    const white = (METRICS.singleNoteAdvance - METRICS.noteBoxWidth) * sp;
    for (const row of splitRowSVGs(on)) {
      const boxes = ligatureBoxes(row);
      for (let i = 0; i + 1 < boxes.length; i++) {
        expect(boxes[i + 1].x - boxes[i].right).toBeGreaterThanOrEqual(white - 0.01);
      }
    }
  });

  it('narrows neume gaps, keeping wrapCondenseMin of their white space (stage 2)', () => {
    const src = '(c4) gagf fgaf gf fgag gfg agf fgf gag\nw: a-a-a-a-a-a-a-a';
    const { off, on } = both(src, { width: 94 });
    expect(rowSyllables(off).map(r => r.length)).toEqual([1, 2, 2, 2, 1]);
    expect(rowSyllables(on).map(r => r.length)).toEqual([2, 2, 2, 2]);
    const sp = renderStaffSpace(on);
    const white = (METRICS.singleNoteAdvance - METRICS.noteBoxWidth) * sp;
    let narrowed = 0;
    for (const row of splitRowSVGs(on)) {
      const boxes = ligatureBoxes(row);
      for (let i = 0; i + 1 < boxes.length; i++) {
        const gap = boxes[i + 1].x - boxes[i].right;
        expect(gap).toBeGreaterThanOrEqual(METRICS.wrapCondenseMin * white - 0.01);
        if (gap < white - 0.01) narrowed++;
      }
    }
    expect(narrowed).toBeGreaterThan(0);
  });

  it('keeps syllables from overlapping in condensed rows', () => {
    for (const width of [87, 115, 357]) {
      const svg = renderAretino(SRC, { width });
      for (const row of splitRowSVGs(svg)) {
        const entries = [...row.matchAll(/<text\b([^>]*)xml:space="preserve"([^>]*)>(.*?)<\/text>/g)]
          .map(m => {
            const attrs = m[1] + m[2];
            const text = m[3].replace(/<[^>]*>/g, '');
            const size = Number(/font-size="([^"]+)"/.exec(attrs)[1]);
            const w = measureTextWidth(text, size);
            const x = Number(/ x="([^"]+)"/.exec(attrs)[1]);
            const left = /text-anchor="middle"/.test(attrs) ? x - w / 2 : x;
            return { left, right: left + w };
          });
        for (let i = 0; i + 1 < entries.length; i++) {
          expect(entries[i].right).toBeLessThanOrEqual(entries[i + 1].left + 0.01);
        }
      }
    }
  });

  it('keeps the lone syllable when pulling back would stretch the row too far', () => {
    const { off, on } = both(SRC, { width: 89 });
    expect(rowsText(off)).toContain(' a | kik ');
    expect(rowsText(on)).toContain(' a | kik ');
    const loose = renderAretino(SRC, { width: 89, wrapStretchMax: 100 });
    expect(rowsText(loose)).toContain(' | a kik ');
  });

  it('keeps the lone syllables rather than adding a row', () => {
    const { off, on } = both(SRC, { width: 101 });
    const loose = renderAretino(SRC, { width: 101, wrapStretchMax: 100, wrapCondenseMin: 0 });
    expect(loneSyllables(off, LYRIC)).toBeGreaterThan(0);
    expect(rowsText(loose)).toBe(rowsText(off));
    expect(rowsText(on)).toBe(rowsText(off));
  });

  it('never moves a manual break', () => {
    const src = '(c4) g f g a g (z) f g a g f\nw: Ó Is-ten kö-nyö rül-je-tek raj';
    const { off, on } = both(src, { width: 600 });
    expect(rowsText(off)).toContain(' kö nyö | rül ');
    expect(on).toBe(off);
  });

  it('renders a score with no lone syllables byte-identically', () => {
    const src = chant('Ó ki jó és szép a mi Urunk ma és most és mind itt');
    for (let width = 80; width <= 400; width += 7) {
      const { off, on } = both(src, { width });
      expect(on).toBe(off);
    }
  });

  it('can be turned off with an %option header', () => {
    const header = renderAretino(`%option: avoidLoneSyllables=false\n${SRC}`, { width: 115 });
    const { off, on } = both(SRC, { width: 115 });
    expect(rowsText(header)).toBe(rowsText(off));
    expect(rowsText(header)).not.toBe(rowsText(on));
  });

  it('never adds rows or loses syllables, however narrow the page', () => {
    const lyric = `${LYRIC} mind-ö-rök-kön-ké-ön, á-men`;
    const src = chant(lyric);
    const syllables = lyric.split(/[\s-]+/).length;
    for (const lyricSize of [10, 24, 40]) {
      for (let width = 60; width <= 360; width += 6) {
        const { off, on } = both(src, { width, lyricSize });
        const rows = rowSyllables(on);
        expect(rows.flat()).toHaveLength(syllables);
        expect(rows.length).toBeLessThanOrEqual(rowSyllables(off).length);
      }
    }
  });

  it('lets a word wider than the row overflow as before', () => {
    const src = '(c4) g f g a\nw: Ó sze-ren-csééééééééééééééééééééééééés';
    for (const width of [60, 90, 120]) {
      const { off, on } = both(src, { width });
      expect(rowSyllables(on).flat()).toEqual(rowSyllables(off).flat());
      expect(rowSyllables(on).every(r => r.length > 0)).toBe(true);
    }
  });

  it('keeps the greedy break when a single-neume row can go nowhere', () => {
    const src = '(c4) g f\nw: Is-ten';
    for (const width of [40, 50, 60]) {
      const { off, on } = both(src, { width, lyricSize: 30 });
      expect(rowsText(off)).toBe(' Is | ten ');
      expect(on).toBe(off);
    }
  });

  it('reduces lone syllables over a range of widths', () => {
    let off = 0;
    let on = 0;
    for (let width = 90; width <= 500; width += 5) {
      const r = both(SRC, { width });
      off += loneSyllables(r.off, LYRIC);
      on += loneSyllables(r.on, LYRIC);
    }
    expect(on).toBeLessThan(off * 0.7);
  });

  it('restates courtesy accidentals at the row starts the new breaks make', () => {
    // Render with the chosen breaks, then write the same breaks as (z): the
    // accidentals must agree with the ones the manual breaks get.
    const pitches = 'gf gbgfgbgfgbgfefg'.replace(' ', '').split('');
    const notes = pitches.map((p, i) => (i === 2 ? `(bb) ${p}` : p));
    const src = `(c4) ${notes.join(' ')}\nw: ${LYRIC}`;
    const courtesy = svg => (svg.match(/aretino-courtesy-accidental/g) || []).length;
    for (const width of [118, 191]) {
      const { off, on } = both(src, { width });
      expect(rowsText(on)).not.toBe(rowsText(off));
      const counts = rowSyllables(on).map(r => r.length);
      const broken = [];
      let n = 0;
      for (const count of counts.slice(0, -1)) {
        n += count;
        broken.push(n);
      }
      const manual = notes.map((note, i) => (broken.includes(i + 1) ? `${note} (z)` : note));
      const manualSvg = renderAretino(`(c4) ${manual.join(' ')}\nw: ${LYRIC}`, { width });
      expect(rowsText(manualSvg)).toBe(rowsText(on));
      expect(courtesy(on)).toBe(courtesy(manualSvg));
      expect(courtesy(on)).toBeGreaterThan(0);
    }
  });
});

function renderStaffSpace(svg) {
  const ys = [...svg.matchAll(/<line[^>]* y1="([^"]+)" x2=/g)].slice(0, 2).map(m => Number(m[1]));
  return Math.abs(ys[0] - ys[1]);
}

// --- lone words of a tenor recitation --------------------------------------

describe('lone recited words', () => {
  const RECITED = '(g2) C b ba ab b ,2 a bt C ag ga C\n'
    + 'w: szük-sé-ges vét-ke! mert Krisztus~halála~lett el-tör-lő-je';

  it('lets a wide word stand alone at a break', () => {
    const { off, on } = both(RECITED, { width: 304 });
    expect(rowsText(off)).toContain(' mert | Krisztus halála lett ');
    expect(rowsText(on)).toContain(' mert Krisztus | halála lett ');
  });

  it('never leaves a short word alone, even at the cost of a line', () => {
    for (let width = 150; width <= 420; width += 10) {
      const text = rowsText(renderAretino(RECITED, { width }));
      expect(text).not.toContain(' halála | lett ');
      expect(text).not.toContain(' mert Krisztus halála | lett ');
    }
  });

  it('treats every word as short when recitationLoneWordMin is large', () => {
    const svg = renderAretino(`%option: recitationLoneWordMin=100\n${RECITED}`, { width: 300 });
    expect(rowsText(svg)).toContain(' mert | Krisztus halála lett ');
  });
});
