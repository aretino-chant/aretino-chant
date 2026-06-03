import { describe, it, expect } from 'vitest';
import { parseAretino } from '../src/parser.js';
import { groupSections, flattenItems } from '../src/items.js';
import { createTransposeState, applyTranspose, transposeSource } from '../src/transpose.js';
import { renderAretino } from '../src/index.js';

// Parse a body source, flatten each section, and transpose it the way the
// renderer does (one running state threaded across sections).
function transpose(src, amount) {
  const ast = parseAretino(src);
  const sections = groupSections(ast.lines);
  const state = createTransposeState(amount);
  const all = [];
  for (const sec of sections) {
    const items = flattenItems(sec.tokens);
    applyTranspose(items, state);
    all.push(...items);
  }
  return all;
}

// The (pitch, accidental-symbol|null) of every note, in order.
function notes(items) {
  const out = [];
  for (const it of items) {
    if (it.kind !== 'ligature') continue;
    for (const group of it.groups) {
      for (const note of group) {
        out.push([note.pitch, note.accidental ? note.accidental.symbol : null]);
      }
    }
  }
  return out;
}

function firstKeySig(items) {
  const ks = items.find(it => it.kind === 'keysig');
  return ks ? ks.accidentals : null;
}

// Standalone accidental items, in order, as (pitch, symbol).
function standaloneAccidentals(items) {
  return items
    .filter(it => it.kind === 'accidental')
    .map(it => [it.pitch, it.symbol]);
}

describe('applyTranspose', () => {
  it('shifts positions a diatonic step for a whole-tone (no new accidentals)', () => {
    // C major up a whole tone = D major: notes move up one step, F# and C# are
    // covered by the (injected) 2-sharp signature so no inline accidentals.
    const items = transpose('c d e f g', 2);
    expect(notes(items)).toEqual([
      ['d', null], ['e', null], ['f', null], ['g', null], ['a', null],
    ]);
    expect(firstKeySig(items)).toEqual([
      { pitch: 'F', symbol: '#' },
      { pitch: 'C', symbol: '#' },
    ]);
  });

  it('injects a 5-flat signature transposing up a semitone from no key', () => {
    const items = transpose('c', 1);
    expect(firstKeySig(items)).toEqual([
      { pitch: 'b', symbol: 'x' },
      { pitch: 'E', symbol: 'x' },
      { pitch: 'a', symbol: 'x' },
      { pitch: 'D', symbol: 'x' },
      { pitch: 'g', symbol: 'x' },
    ]);
    // c → Db, which is in key, so no inline accidental.
    expect(notes(items)).toEqual([['d', null]]);
  });

  it('emits a needed accidental on a note inside a neume', () => {
    // c(g#)g is one neume [c, g#]. Up a whole tone the g# becomes a#, which is
    // outside D major, so that note keeps an inline sharp while c (→ d) does not.
    const items = transpose('c(g#)g', 2);
    expect(notes(items)).toEqual([['d', null], ['a', '#']]);
  });

  it('shows a chromatic accidental once per bar and restates it after a barline', () => {
    // (f#) before a neume is a standalone accidental that covers the rest of the
    // bar. Up a whole tone it becomes g#, drawn once per bar; the covered notes
    // get no inline accidental.
    const items = transpose('(f#)f f , (f#)f f', 2);
    expect(standaloneAccidentals(items)).toEqual([['g', '#'], ['g', '#']]);
    expect(notes(items)).toEqual([
      ['g', null], ['g', null], ['g', null], ['g', null],
    ]);
  });

  it('drops a source accidental the new key signature now covers', () => {
    // (en) is an explicit E-natural. Up a whole tone the note becomes F#, which
    // the D-major signature already provides, so the accidental disappears
    // entirely — no inline accidental and no standalone one.
    const items = transpose('(en)e', 2);
    expect(notes(items)).toEqual([['f', null]]);
    expect(standaloneAccidentals(items)).toEqual([]);
  });

  it('transposes downward for a negative amount', () => {
    const items = transpose('c', -1);
    expect(notes(items)).toEqual([['B', null]]);
    expect(firstKeySig(items)).toEqual([
      { pitch: 'F', symbol: '#' },
      { pitch: 'C', symbol: '#' },
      { pitch: 'G', symbol: '#' },
      { pitch: 'D', symbol: '#' },
      { pitch: 'a', symbol: '#' },
    ]);
  });

  it('transposes a cross-pitch accidental in place, not at the neume start', () => {
    // `(bb)` before an f is a directive that flats every B for the rest of the
    // bar (the f itself stays natural). Up a whole tone the directive moves to
    // its OWN transposed pitch (B-flat → C-natural) and stays in front of the
    // same note — it must NOT be re-pitched onto the note (which would land a
    // flat on the g at the neume head). The later b → C is then covered by it.
    const items = transpose('ef.(bb)f`ab`C', 2);
    // Note pitches shift up one diatonic step throughout.
    const pitches = [];
    for (const it of items) {
      if (it.kind !== 'ligature') continue;
      for (const g of it.groups) for (const n of g) pitches.push(n.pitch);
    }
    expect(pitches).toEqual(['f', 'g', 'g', 'b', 'C', 'D']);
    // The only displayed accidental is the transposed directive: it stays on
    // the third note's slot (the former f→g) but at its OWN pitch C, natural.
    const accs = [];
    for (const it of items) {
      if (it.kind !== 'ligature') continue;
      for (const g of it.groups) for (const n of g) {
        if (n.accidental) accs.push([n.pitch, n.accidental.pitch, n.accidental.symbol]);
      }
    }
    expect(accs).toEqual([['g', 'C', 'y']]);
  });

  it('transposes an existing key signature', () => {
    // 1 flat (Bb) up a whole tone → 1 sharp (F#).
    const items = transpose('(Kb) c d', 2);
    expect(firstKeySig(items)).toEqual([{ pitch: 'F', symbol: '#' }]);
  });

  it('is a no-op for amount 0', () => {
    const before = notes(transpose('(g2) c d e f g', 0));
    expect(before).toEqual([
      ['c', null], ['d', null], ['e', null], ['f', null], ['g', null],
    ]);
  });
});

// Flatten a plain (already-transposed) source the way the renderer would,
// without applying any further transposition.
function flatten(src) {
  const ast = parseAretino(src);
  const all = [];
  for (const sec of groupSections(ast.lines)) all.push(...flattenItems(sec.tokens));
  return all;
}

describe('transposeSource', () => {
  it('is a no-op for amount 0 and for empty input', () => {
    expect(transposeSource('(g2) c d e', 0)).toBe('(g2) c d e');
    expect(transposeSource('', 2)).toBe('');
  });

  it('shifts pitch letters up a whole tone and injects a 2-sharp signature', () => {
    expect(transposeSource('(g2) c d e f g', 2)).toBe('(g2) (K##) d e f g a');
  });

  it('introduces a 5-flat signature transposing up a semitone', () => {
    // c → Db major (5 flats); c itself becomes Db, which is in key.
    expect(transposeSource('c', 1)).toBe('(Kbbbbb) d');
  });

  it('keeps a needed inline accidental inside a neume', () => {
    // c(g#)g up a whole tone → d a#, the a# stays since it is outside D major
    // (a 2-sharp signature is introduced since the source had none).
    expect(transposeSource('c(g#)g', 2)).toBe('(K##) d(a#)a');
  });

  it('drops an inline accidental the new key signature now covers', () => {
    // (en)e up a whole tone → f#, provided by the injected D-major signature.
    expect(transposeSource('(en)e', 2)).toBe('(K##) f');
  });

  it('transposes an existing key signature and inserts accidentals where needed', () => {
    // (f#) is a standalone accidental covering the bar; up a tone it becomes g#,
    // restated after the barline. The injected 2-sharp signature lands before
    // the first note (after the leading accidental), as in the render path.
    expect(transposeSource('(f#)f f , (f#)f f', 2)).toBe('(g#)(K##) g g , (g#)g g');
  });

  it('rewrites an existing key-signature directive', () => {
    expect(transposeSource('(Kb) c d', 2)).toBe('(K#) d e');
  });

  it('shifts octaves with ^/v markers and preserves modifiers', () => {
    // G (top of staff) up a whole tone is A above it: a with a +1 octave marker.
    expect(transposeSource("G'", 2)).toBe("(K##) ^a'");
  });

  it('produces source that re-parses to the render-time transposition', () => {
    for (const src of ['(g2) c d e f g', '(Kb) c d e', 'c(g#)g', '(en)e', "G' a b"]) {
      for (const n of [1, 2, -1, -3, 5, 12]) {
        const baked = flatten(transposeSource(src, n));
        const direct = transpose(src, n);
        expect(notes(baked)).toEqual(notes(direct));
        expect(firstKeySig(baked)).toEqual(firstKeySig(direct));
        expect(standaloneAccidentals(baked)).toEqual(standaloneAccidentals(direct));
      }
    }
  });
});

describe('renderAretino with %transpose', () => {
  it('renders without throwing and produces an svg', () => {
    const svg = renderAretino('% transpose: 1\n%%\n(g2) c d e f g\nw: a b c d e', { width: 600 });
    expect(svg).toContain('<svg');
  });

  it('leaves output unchanged for transpose: 0', () => {
    const base = renderAretino('% transpose: 0\n%%\n(g2) c d e', { width: 600 });
    const none = renderAretino('% transpose: 0\n%%\n(g2) c d e', { width: 600 });
    expect(base).toBe(none);
  });
});
