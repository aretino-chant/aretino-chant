import { describe, it, expect } from 'vitest';
import { buildPlayback, splitSyllables, syllabifyWord, accentIndex, detectLanguage, DEFAULT_EXPRESSION, DEFAULT_RHYTHM } from '../src/index.js';

const NO_JITTER = { humanize: 0 };
const notes = pb => pb.events.filter(e => e.type === 'note');
const shaped = (src, expression = {}, more = {}) => buildPlayback(src, { expression: { ...NO_JITTER, ...expression }, ...more });

describe('prosody — syllables', () => {
  it('breaks Hungarian words with digraphs as single consonants', () => {
    expect(syllabifyWord('Dicsőség', 'hu')).toEqual(['Di', 'cső', 'ség']);
    expect(syllabifyWord('Atyának', 'hu')).toEqual(['A', 'tyá', 'nak']);
    expect(syllabifyWord('mindörökkön', 'hu')).toEqual(['min', 'dö', 'rök', 'kön']);
    // A doubled digraph (ssz) is cut between its two consonants; the
    // written doubling is not restored, the count and the accent are what matter.
    expect(syllabifyWord('asszony', 'hu')).toEqual(['as', 'szony']);
  });

  it('breaks Latin words, keeping stop + liquid and diphthongs together', () => {
    expect(syllabifyWord('Dominus', 'la')).toEqual(['Do', 'mi', 'nus']);
    expect(syllabifyWord('sanctorum', 'la')).toEqual(['sanc', 'to', 'rum']);
    expect(syllabifyWord('patrem', 'la')).toEqual(['pa', 'trem']);
    expect(syllabifyWord('laudate', 'la')).toEqual(['lau', 'da', 'te']);
    expect(syllabifyWord('saeculorum', 'la')).toEqual(['sae', 'cu', 'lo', 'rum']);
    expect(syllabifyWord('qui', 'la')).toEqual(['qui']);
    expect(syllabifyWord('Kyrie', 'la')).toEqual(['Ky', 'ri', 'e']);
  });

  it('keeps punctuation on the syllable it follows', () => {
    expect(splitSyllables('Dómine, exáudi.', { language: 'la' }).map(s => [s.text, s.punct])).toEqual([
      ['Dó', ''], ['mi', ''], ['ne,', ','], ['ex', ''], ['áu', ''], ['di.', '.'],
    ]);
  });

  it('detects the language from Hungarian letters and digraphs', () => {
    expect(detectLanguage('Dicsőség az Atyának')).toBe('hu');
    expect(detectLanguage('Gloria Patri et Filio')).toBe('la');
    expect(detectLanguage('')).toBe('la');
  });
});

describe('prosody — accents', () => {
  it('stresses the first syllable in Hungarian', () => {
    expect(accentIndex(['A', 'tyá', 'nak'], 'hu')).toBe(0);
    expect(accentIndex(['és'], 'hu')).toBe(0);
  });

  it('follows a printed accent in Latin, else the penult rule', () => {
    expect(accentIndex(['Dó', 'mi', 'nus'], 'la')).toBe(0);
    expect(accentIndex(['Do', 'mi', 'nus'], 'la')).toBe(0);
    expect(accentIndex(['sanc', 'tó', 'rum'], 'la')).toBe(1);
    expect(accentIndex(['om', 'nis', 'ten', 'tem'], 'la')).toBe(2);
    expect(accentIndex(['Pa', 'tri'], 'la')).toBe(0);
    expect(accentIndex(['et'], 'la')).toBe(-1);
  });

  it('marks accents and word positions on the split', () => {
    const s = splitSyllables('Glória Patri et', { language: 'la' });
    expect(s.map(x => [x.word, x.pos, x.len, x.accented])).toEqual([
      [0, 1, 3, true], [0, 2, 3, false], [0, 3, 3, false],
      [1, 1, 2, true], [1, 2, 2, false],
      [2, 1, 1, false],
    ]);
  });
});

describe('expression — text', () => {
  it('lifts the accented syllable and settles the word-final one', () => {
    const pb = shaped('(g2) g a b\nw: Dó-mi-nus');
    const ev = notes(pb);
    expect(ev.map(e => e.expression)).toEqual([['accent'], [], ['thesis']]);
    expect(ev[0].gain).toBeGreaterThan(ev[1].gain);
    // The thesis relaxes by easing off through the note, not by slowing down.
    expect(ev[2].gain).toBeLessThan(ev[1].gain);
    expect(ev[2].gainStart).toBeCloseTo(ev[2].gain - DEFAULT_EXPRESSION.thesisGain, 6);
    expect(ev[1].gainStart).toBeUndefined();
    expect(ev[2].units).toBe(1);
    expect(ev[1].units).toBe(1);
  });

  it('accents Hungarian words on their first syllable, with the language from the header', () => {
    const pb = buildPlayback('%language: hu\n%%\n(g2) g a b\nw: Do-mi-nus', { expression: NO_JITTER });
    expect(pb.language).toBe('hu');
    expect(notes(pb).map(e => e.expression)).toEqual([['accent'], [], ['thesis']]);
  });

  it('lets punctuation pass: the bar lines drive the pauses', () => {
    const src = '(g2) g g g g g g g g g g g g g g g g g g | g g\nw: Miképpen~kezdetben,~most~és min-den-kor (*) és~mindörökkön~ö-rök-ké. Á-men.';
    const pb = shaped(src);
    expect(pb.events.filter(e => e.type === 'rest').map(e => e.barline)).toEqual(['|']);
    const punctuated = notes(pb).filter(e => e.word?.punct);
    expect(punctuated.length).toBeGreaterThan(0);
    expect(punctuated.every(e => e.units <= 1.5)).toBe(true);
    expect(notes(pb).some(e => e.syllable?.text === 'ké.')).toBe(true);
  });

  it('can be asked to breathe at a comma or a full stop, unless a bar line follows', () => {
    const pb = shaped('(g2) g a b | C\nw: a, b. c d', { comma: { stretch: 1.2, breath: 0.25 }, stop: { stretch: 1.4, breath: 0.5 } });
    const types = pb.events.map(e => e.type + (e.breath ? '(breath)' : '') + (e.barline ? e.barline : ''));
    expect(types).toEqual(['note', 'rest(breath)', 'note', 'rest(breath)', 'note', 'rest|', 'note']);
    expect(pb.events[1].units).toBe(0.25);
    expect(pb.events[3].units).toBe(0.5);
    expect(notes(pb)[0].units).toBeCloseTo(1.2, 6);
    expect(notes(pb)[1].units).toBeCloseTo(1.4, 6);
  });

  it('accents the words inside a recitation', () => {
    const pb = shaped('(g2) gt a\nw: Dóminus~vobíscum la');
    const rec = notes(pb).filter(e => e.recitation);
    expect(rec.map(e => e.word.accented)).toEqual([true, false, false, false, true, false]);
    expect(rec.map(e => e.expression)).toEqual([['accent'], ['flow'], ['thesis'], ['flow'], ['accent'], ['thesis']]);
  });

  it('applies the accent only to the first note of a melisma and the thesis to its last', () => {
    const pb = shaped('(g2) g ab a g a\nw: Dó - - - mi-nus');
    const ev = notes(pb);
    expect(ev[0].expression).toContain('accent');
    expect(ev[1].expression).not.toContain('accent');
    expect(ev[ev.length - 1].expression).toContain('thesis');
  });
});

describe('expression — neume and phrase', () => {
  it('touches down on the first note, flows through the middle, reposes on the last, lifts the peak', () => {
    const pb = shaped('(g2) gabag');
    expect(notes(pb).map(e => e.expression)).toEqual([['ictic'], ['flow'], ['flow', 'peak'], ['flow'], ['repose']]);
    const u = notes(pb).map(e => +e.units.toFixed(4));
    expect(u).toEqual([1, 0.96, 0.96, 0.96, 1.03]);
    const g = notes(pb).map(e => e.gain);
    expect(g[4]).toBeLessThan(g[3]);
    expect(notes(pb)[4].gainStart).toBeGreaterThan(g[4]);
  });

  it('honours a written ictus and keeps a quilisma light', () => {
    const pb = shaped('(g2) g- aw');
    expect(notes(pb)[0].expression).toContain('ictus');
    expect(notes(pb)[1].expression).toContain('light');
  });

  it('plays higher notes of a phrase a little louder', () => {
    const pb = shaped('(g2) g b D');
    const g = notes(pb).map(e => e.gain);
    expect(g[0]).toBeLessThan(g[1]);
    expect(g[1]).toBeLessThan(g[2]);
  });

  it('eases off on the last note before a bar line', () => {
    const pb = shaped('(g2) g g | g');
    const last = notes(pb)[1];
    expect(last.expression).toContain('cadence');
    expect(last.gainStart).toBeCloseTo(last.gain - DEFAULT_EXPRESSION.cadenceGain, 6);
  });

  it('treats a standalone ~ as a quarter bar', () => {
    const pb = shaped('(g2) g g g g ~ g');
    expect(notes(pb).slice(0, 4).map(e => +e.units.toFixed(4))).toEqual([1, 1.04, 1.1, 1.25]);
  });

  it('moves on through the unaccented inner syllables of a recitation', () => {
    const pb = shaped('(g2) gt a\nw: Dóminus~vobíscum la');
    const rec = notes(pb).filter(e => e.recitation);
    expect(rec.map(e => +e.units.toFixed(4))).toEqual([1, 0.94, 1, 0.94, 1, 1]);
  });

  it('ritards into every bar line alike', () => {
    const full = shaped('(g2) g g g g | g');
    expect(notes(full).slice(0, 4).map(e => +e.units.toFixed(4))).toEqual([1, 1.04, 1.1, 1.25]);
    const half = shaped('(g2) g g g g ; g');
    expect(notes(half).slice(0, 4).map(e => +e.units.toFixed(4))).toEqual([1, 1.04, 1.1, 1.25]);
    const quarter = shaped('(g2) g g g g , g');
    expect(notes(quarter).slice(0, 4).map(e => +e.units.toFixed(4))).toEqual([1, 1.04, 1.1, 1.25]);
    expect(notes(quarter)[3].expression).toContain('cadence');
  });

  it('is deterministic for a seed and off when humanize is zero', () => {
    const a = buildPlayback('(g2) g a b C', { expression: { seed: 7 } });
    const b = buildPlayback('(g2) g a b C', { expression: { seed: 7 } });
    const c = buildPlayback('(g2) g a b C', { expression: { seed: 8 } });
    expect(a.events.map(e => e.units)).toEqual(b.events.map(e => e.units));
    expect(a.events.map(e => e.units)).not.toEqual(c.events.map(e => e.units));
    expect(a.events.every(e => Math.abs(e.units - 1) <= DEFAULT_EXPRESSION.humanize + 1e-9)).toBe(true);
  });

  it('can be switched off entirely', () => {
    const pb = buildPlayback('(g2) gabag | g\nw: Dó-mi', { expression: false });
    expect(notes(pb).every(e => e.units === 1 || e.units === DEFAULT_RHYTHM.cadence)).toBe(true);
    expect(notes(pb)[0].expression).toBeUndefined();
  });
});
