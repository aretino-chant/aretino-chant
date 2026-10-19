import { describe, it, expect } from 'vitest';
import { buildPlayback as build, countSyllables, parseAretino, DEFAULT_RHYTHM, DEFAULT_PAUSES } from '../src/index.js';

// These tests pin the mechanical pulse; expression.test.js covers the shading.
const buildPlayback = (src, o = {}) => build(src, { expression: false, ...o });

function notes(pb) {
  return pb.events.filter(e => e.type === 'note');
}

function units(pb) {
  return notes(pb).map(e => +(e.units).toFixed(4));
}

function midis(pb) {
  return notes(pb).map(e => e.midi);
}

describe('buildPlayback — pitch', () => {
  it('reads the letters as literal pitches under a G clef on line 2', () => {
    expect(midis(buildPlayback('(g2) c d e f g a b C D E F G'))).toEqual([60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79]);
    expect(midis(buildPlayback('(g2) A B'))).toEqual([57, 59]);
  });

  it('defaults to a G clef when none is written', () => {
    expect(midis(buildPlayback('g a b'))).toEqual([67, 69, 71]);
  });

  it('maps staff positions through C and F clefs', () => {
    // (c3): the third line (position 4, letter b) sounds middle C.
    expect(midis(buildPlayback('(c3) b C D E'))).toEqual([60, 62, 64, 65]);
    // (f4): the fourth line (position 6, letter D) sounds F3.
    expect(midis(buildPlayback('(f4) D E F'))).toEqual([53, 55, 57]);
    // (c4): the fourth line sounds C, so the second line is F below it.
    expect(midis(buildPlayback('(c4) g a b C D'))).toEqual([53, 55, 57, 59, 60]);
  });

  it('follows a clef change mid-line', () => {
    expect(midis(buildPlayback('(g2) g (c3) b'))).toEqual([67, 60]);
  });

  it('honours octave-shift markers', () => {
    expect(midis(buildPlayback('(g2) ^a vg ^^c'))).toEqual([81, 55, 84]);
  });

  it('applies inline accidentals until the next bar line, on that staff position only', () => {
    expect(midis(buildPlayback('(g2) (bb) b b B | b'))).toEqual([70, 70, 59, 71]);
    expect(midis(buildPlayback('(g2) (f#) f f ; f'))).toEqual([66, 66, 65]);
    expect(midis(buildPlayback('(g2) (bb) b (n) b'))).toEqual([70, 71]);
  });

  it('applies a standalone accidental directive to the following notes', () => {
    expect(midis(buildPlayback('(g2) (b) b a b | b'))).toEqual([70, 69, 70, 71]);
  });

  it('applies key signatures in every octave until replaced', () => {
    expect(midis(buildPlayback('(g2) (Kb) b B | b (K) b'))).toEqual([70, 58, 70, 71]);
    expect(midis(buildPlayback('(g2) (K:f# C#) f C'))).toEqual([66, 73]);
    expect(midis(buildPlayback('(g2) (K##) f C'))).toEqual([66, 73]);
  });

  it('lets an inline accidental override the key signature within the bar', () => {
    expect(midis(buildPlayback('(g2) (Kb) (n) b b | b'))).toEqual([71, 71, 70]);
  });

  it('transposes by the %transpose header and the transpose option', () => {
    expect(midis(buildPlayback('%transpose: 2\n%%\n(g2) g a'))).toEqual([69, 71]);
    expect(midis(buildPlayback('(g2) g a', { transpose: -3 }))).toEqual([64, 66]);
    expect(midis(buildPlayback('%transpose: 2\n%%\n(g2) g', { transpose: 1 }))).toEqual([70]);
  });

  it('gives every note a frequency', () => {
    const [a] = notes(buildPlayback('(g2) a'));
    expect(a.frequency).toBeCloseTo(440, 5);
  });
});

describe('buildPlayback — rhythm', () => {
  it('gives plain notes and virgas one pulse each', () => {
    expect(units(buildPlayback("(g2) g a' b"))).toEqual([1, 1, 1]);
  });

  it('derives the pulse length from the tempo', () => {
    const pb = buildPlayback('(g2) g a', { tempo: 120 });
    expect(pb.unit).toBe(0.5);
    expect(notes(pb).map(e => e.time)).toEqual([0, 0.5]);
    expect(pb.duration).toBe(1);
  });

  it('reads the tempo from a %tempo header, with the option overriding it', () => {
    expect(buildPlayback('%tempo: 90\n%%\n(g2) g').tempo).toBe(90);
    expect(buildPlayback('%tempo: 90\n%%\n(g2) g', { tempo: 60 }).tempo).toBe(60);
    expect(buildPlayback('(g2) g').tempo).toBe(180);
  });

  it('doubles a dotted note and broadens an episema', () => {
    expect(units(buildPlayback('(g2) g. g_ g._'))).toEqual([DEFAULT_RHYTHM.mora, DEFAULT_RHYTHM.episema, DEFAULT_RHYTHM.mora * DEFAULT_RHYTHM.episema]);
  });

  it('keeps the ictus from changing the length', () => {
    expect(units(buildPlayback('(g2) g- g'))).toEqual([1, 1]);
  });

  it('shortens the quilisma and lengthens the note before it', () => {
    expect(units(buildPlayback('(g2) g aw b'))).toEqual([DEFAULT_RHYTHM.beforeQuilisma, DEFAULT_RHYTHM.quilisma, 1]);
    expect(units(buildPlayback('(g2) gawb'))).toEqual([DEFAULT_RHYTHM.beforeQuilisma, DEFAULT_RHYTHM.quilisma, 1]);
  });

  it('does not lengthen an already long note before a quilisma', () => {
    expect(units(buildPlayback('(g2) g. aw'))).toEqual([2, DEFAULT_RHYTHM.quilisma]);
  });

  it('keeps the lengthened note in place: later notes start later', () => {
    const pb = buildPlayback('(g2) g aw b', { tempo: 60 });
    expect(notes(pb).map(e => e.time)).toEqual([0, 1.5, 2.25]);
  });

  it('holds a textless tenor note for the tenor length', () => {
    expect(units(buildPlayback('(g2) gt a'))).toEqual([DEFAULT_RHYTHM.tenor, 1]);
  });

  it('recites a tenor note once per syllable of the text under it', () => {
    const pb = buildPlayback('(g2) g gt a\nw: Al-le~lu~ia~sing le');
    const ev = notes(pb);
    expect(ev.map(e => e.units)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    const rec = ev.filter(e => e.recitation);
    expect(rec.map(e => e.recitation)).toEqual([1, 2, 3, 4, 5]);
    expect(rec.map(e => e.legato)).toEqual([true, true, true, true, false]);
    expect(rec.map(e => !!e.rearticulate)).toEqual([false, true, true, true, true]);
    expect(rec.every(e => e.recitationCount === 5 && e.midi === 67 && e.shape === 'tenor')).toBe(true);
    expect(rec.every(e => e.srcStart === 7 && e.srcEnd === 9)).toBe(true);
  });

  it('recites a tenor carrying a single syllable as one pulse', () => {
    const pb = buildPlayback('(g2) gt a\nw: Al le');
    expect(units(pb)).toEqual([1, 1]);
    expect(notes(pb)[0].recitation).toBeUndefined();
  });

  it('lets a host supply its own syllable counter', () => {
    const pb = buildPlayback('(g2) gt a\nw: Al~le~lu le', { countSyllables: () => 7 });
    expect(notes(pb).filter(e => e.recitation).length).toBe(7);
  });

  it('ties a repeated pitch inside a neume into one longer sound', () => {
    const pb = buildPlayback('(g2) gg a ggg');
    expect(units(pb)).toEqual([2, 1, 3]);
    expect(notes(pb)[0].tied).toBe(2);
    expect(notes(pb)[2].tied).toBe(3);
    expect(notes(pb)[0].legato).toBe(false);
  });

  it('does not tie repeated pitches across neumes or groups, after a mora, or when asked not to', () => {
    expect(units(buildPlayback('(g2) g g gg/gg'))).toEqual([1, 1, 2, 2]);
    expect(units(buildPlayback('(g2) g.g'))).toEqual([2, 1]);
    // The mora closes a sub-neume: the repeat is re-attacked, not slurred.
    expect(notes(buildPlayback('(g2) g.g'))[0].legato).toBe(false);
    expect(units(buildPlayback('(g2) gg', { tieRepeats: false }))).toEqual([1, 1]);
  });

  it('splits a plica note into its main pitch and a soft liquescent step below', () => {
    const pb = buildPlayback('(g2) a~ g');
    const ev = notes(pb);
    expect(ev.length).toBe(3);
    expect(ev[0].midi).toBe(69);
    expect(ev[0].legato).toBe(true);
    expect(ev[1].midi).toBe(67);
    expect(ev[1].liquescent).toBe(true);
    expect(ev[1].gain).toBeLessThan(ev[0].gain);
    expect(+(ev[0].units + ev[1].units).toFixed(6)).toBe(DEFAULT_RHYTHM.plica);
    expect(ev[0].units).toBeCloseTo(DEFAULT_RHYTHM.plica * (1 - DEFAULT_RHYTHM.plicaShare));
  });

  it('plays a plica as one note when the liquescent share is zero', () => {
    const pb = buildPlayback('(g2) a~ g', { rhythm: { plicaShare: 0 } });
    expect(units(pb)).toEqual([1, 1]);
  });

  it('marks notes inside a neume group legato except the last', () => {
    const pb = buildPlayback('(g2) gab c/d e');
    expect(notes(pb).map(e => e.legato)).toEqual([true, true, false, false, false, false]);
  });

  it('lengthens the undotted last note before a full bar, but not a dotted one', () => {
    expect(units(buildPlayback('(g2) g a | g a. | g'))).toEqual([1, DEFAULT_RHYTHM.cadence, 1, 2, 1]);
    expect(units(buildPlayback('(g2) g a , g a ; g'))).toEqual([1, 1, 1, 1, 1]);
    expect(units(buildPlayback('(g2) g a | g', { rhythm: { cadence: 1 } }))).toEqual([1, 1, 1]);
  });

  it('pauses after bar lines by their weight', () => {
    const pb = buildPlayback("(g2) g , g ; g | g ' g || g");
    const rests = pb.events.filter(e => e.type === 'rest');
    expect(rests.map(r => r.barline)).toEqual([',', ';', '|', "'", '||']);
    expect(buildPlayback('(g2) d ~ d').events.map(e => e.type === 'rest' ? `${e.barline}:${e.units}` : e.pitch)).toEqual(['d', '~:0.5', 'd']);
    expect(rests.map(r => r.units)).toEqual([DEFAULT_PAUSES[','], DEFAULT_PAUSES[';'], DEFAULT_PAUSES['|'], DEFAULT_PAUSES["'"], DEFAULT_PAUSES['||']]);
    expect(rests[2].srcStart).toBe('(g2) g , g ; g '.length);
  });

  it('accepts custom pauses and drops zero-length ones', () => {
    const pb = buildPlayback('(g2) g , g | g', { pauses: { ',': 0, '|': 4 } });
    const rests = pb.events.filter(e => e.type === 'rest');
    expect(rests.map(r => [r.barline, r.units])).toEqual([['|', 4]]);
  });

  it('separates sections with a pause unless a bar line already does', () => {
    const a = buildPlayback('(g2) g a\n\n(g2) b');
    expect(a.events.map(e => e.type)).toEqual(['note', 'note', 'rest', 'note']);
    expect(a.events[2].units).toBe(DEFAULT_PAUSES.section);
    const b = buildPlayback('(g2) g a ||\n\n(g2) b');
    expect(b.events.map(e => e.type)).toEqual(['note', 'note', 'rest', 'note']);
    expect(b.events[2].barline).toBe('||');
  });

  it('carries the clef and key signature into the next section', () => {
    expect(midis(buildPlayback('(c3) b\n\nb'))).toEqual([60, 60]);
    expect(midis(buildPlayback('(g2) (Kb) b B\n\nb'))).toEqual([70, 58, 70]);
  });

  it('reads key-signature and inline accidentals by staff position, whatever the clef', () => {
    // Under (c3) the letter b sits on the C line, so a flat on b lowers that C.
    expect(midis(buildPlayback('(c3) (Kb) b E'))).toEqual([59, 65]);
  });

  it('keeps times monotonic and the duration equal to the last end', () => {
    const pb = buildPlayback('(g2) g aw b. | gg a~ , gt C\nw: a b c d e~f g');
    let t = 0;
    for (const ev of pb.events) {
      expect(ev.time).toBeGreaterThanOrEqual(t - 1e-9);
      t = ev.time + ev.duration;
    }
    expect(pb.duration).toBeCloseTo(t, 9);
  });
});

describe('buildPlayback — lyrics', () => {
  it('attaches the sung syllable to each note and carries it over a melisma', () => {
    const src = '(g2) g ab a g a\nw: Al-le-lu - - ia';
    const pb = buildPlayback(src);
    expect(notes(pb).map(e => e.syllable?.text)).toEqual(['Al', 'le', 'le', 'lu', 'lu', 'ia']);
    const first = notes(pb)[0].syllable;
    expect(src.slice(first.srcStart, first.srcEnd)).toBe('Al');
  });

  it('lists syllables with their start times and lengths', () => {
    const pb = buildPlayback('(g2) g ab a g a\nw: Al-le-lu - - ia', { tempo: 60 });
    expect(pb.syllables.map(s => [s.text, s.time, s.duration])).toEqual([
      ['Al', 0, 1], ['le', 1, 2], ['lu', 3, 2], ['ia', 5, 1],
    ]);
  });

  it('does not count division marks as syllables', () => {
    const pb = buildPlayback('(g2) g a b\nw: Al * le');
    expect(pb.syllables.map(s => s.text)).toEqual(['Al', 'le']);
    expect(notes(pb)[1].syllable.text).toBe('Al');
  });

  it('uses the chosen stanza for the text and the tenor recitation', () => {
    const src = '(g2) gt a\nw: la~la la\nw: la~la~la la';
    expect(notes(buildPlayback(src)).length).toBe(3);
    expect(notes(buildPlayback(src, { stanza: 1 })).length).toBe(4);
    expect(notes(buildPlayback(src, { stanza: 1 }))[0].syllable.text).toBe('la la la');
  });

  it('leaves notes without a syllable when there are no lyrics', () => {
    const pb = buildPlayback('(g2) g a');
    expect(notes(pb).every(e => e.syllable === null)).toBe(true);
    expect(pb.syllables).toEqual([]);
  });
});

describe('buildPlayback — source spans', () => {
  it('carries note and neume source spans for highlighting', () => {
    const src = '(g2) g ab';
    const pb = buildPlayback(src);
    const ev = notes(pb);
    expect(src.slice(ev[0].srcStart, ev[0].srcEnd)).toBe('g');
    expect(src.slice(ev[1].srcStart, ev[1].srcEnd)).toBe('a');
    expect(src.slice(ev[1].ligStart, ev[1].ligEnd)).toBe('ab');
  });

  it('accepts a pre-parsed AST', () => {
    const ast = parseAretino('(g2) g a');
    expect(midis(buildPlayback(ast))).toEqual([67, 69]);
  });
});

describe('countSyllables', () => {
  it('counts Hungarian vowels one by one', () => {
    expect(countSyllables('Dicsőség')).toBe(3);
    expect(countSyllables('az Atyának és Fiúnak')).toBe(8);
    expect(countSyllables('leány')).toBe(2);
    expect(countSyllables('mindörökkön örökké')).toBe(7);
  });

  it('treats y in Hungarian digraphs as a consonant but in Latin as a vowel', () => {
    expect(countSyllables('Kyrie')).toBe(3);
    expect(countSyllables('gyermek')).toBe(2);
    expect(countSyllables('lyuk')).toBe(1);
  });

  it('merges Latin diphthongs', () => {
    expect(countSyllables('saeculorum')).toBe(4);
    expect(countSyllables('laudate')).toBe(3);
    expect(countSyllables('coelum')).toBe(2);
  });

  it('returns zero for text without vowels', () => {
    expect(countSyllables('*')).toBe(0);
    expect(countSyllables('')).toBe(0);
  });
});

describe('buildPlayback — accidental placement', () => {
  it('applies an accidental glued after a note to the next note, not the neume before it', () => {
    expect(midis(buildPlayback('(g2) a(bb) b a b ; b'))).toEqual([69, 70, 69, 70, 71]);
    expect(midis(buildPlayback('(g2) ga(bb) b'))).toEqual([67, 69, 70]);
  });

  it('keeps the accidental through every note on that position until any bar line', () => {
    expect(midis(buildPlayback("(g2) (bb) b a b , b ' b ; b | b"))).toEqual([70, 69, 70, 71, 71, 71, 71]);
  });
});

describe('buildPlayback — accidental inside a neume', () => {
  it('flattens the b, not the note the sign is glued to', () => {
    const src = "(g2) a a'gf-ef.(bb)f`ab`C'.D'CbC.";
    const pb = buildPlayback(src);
    const byPitch = notes(pb).map(e => `${e.pitch}:${e.midi}`);
    expect(byPitch).toEqual(['a:69', 'a:69', 'g:67', 'f:65', 'e:64', 'f:65', 'f:65', 'a:69', 'b:70', 'C:72', 'D:74', 'C:72', 'b:70', 'C:72']);
  });

  it('still changes the note itself when the sign names its own letter', () => {
    expect(midis(buildPlayback('(g2) a(f#)fg f'))).toEqual([69, 66, 67, 66]);
  });
});
