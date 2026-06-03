import { describe, it, expect } from 'vitest';
import { parseAretino } from '../src/parser.js';
import { groupSections, flattenItems } from '../src/items.js';
import { createTransposeState, applyTranspose } from '../src/transpose.js';
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
