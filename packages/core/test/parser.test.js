import { describe, it, expect } from 'vitest';
import { parseAretino, matchAccidental } from '../src/index.js';

describe('parseAretino', () => {
  it('returns an object for empty input', () => {
    const ast = parseAretino('');
    expect(ast).toBeTypeOf('object');
  });

  it('preserves multiple option headers in source order', () => {
    const ast = parseAretino('%option: lyricDistance=2\n%option: hideRepeatClef=true\n%%\ng h i');
    expect(ast.header.option).toBe('hideRepeatClef=true');
    expect(ast.optionHeaders).toEqual(['lyricDistance=2', 'hideRepeatClef=true']);
  });

  it('uses n: to resume music and append the following w: to the previous lyrics', () => {
    const source = 'c d\nw: one two\nn: e f\nw: three four';
    const ast = parseAretino(source);

    expect(ast.lines.map(l => l.type)).toEqual(['music', 'lyrics', 'music']);
    expect(ast.lines[1].text).toBe('one two three four');
    expect(ast.lines[2].tokens[0].srcStart).toBe(source.indexOf('e f'));
  });

  it('continues appended n:/w: lyrics with unprefixed text lines', () => {
    const ast = parseAretino('c\nw: one\nn: d\nw: two\nthree');

    expect(ast.lines.map(l => l.type)).toEqual(['music', 'lyrics', 'music']);
    expect(ast.lines[1].text).toBe('one two three');
  });

  it('continues multiple lyric lines in order after n:', () => {
    const ast = parseAretino('c\nw: one\nw: uno\nn: d\nw: two\nw: dos');
    const lyrics = ast.lines.filter(l => l.type === 'lyrics').map(l => l.text);

    expect(ast.lines.map(l => l.type)).toEqual(['music', 'lyrics', 'lyrics', 'music']);
    expect(lyrics).toEqual(['one two', 'uno dos']);
  });

  it('preserves source offsets for continued lyric text', () => {
    const source = 'c d\nw: one two\nn: e f\nw: three four';
    const ast = parseAretino(source);
    const lyric = ast.lines.find(l => l.type === 'lyrics');

    expect(lyric.text).toBe('one two three four');
    expect(lyric.srcStart).toBe(source.indexOf('one'));
    expect(lyric.srcEnd).toBe(source.indexOf('four') + 'four'.length);
    expect(lyric.sourceMap[0]).toBe(source.indexOf('one'));
    expect(lyric.sourceMap['one two'.length]).toBeNull();
    expect(lyric.sourceMap['one two '.length]).toBe(source.indexOf('three'));
  });

  it('preserves source offsets for inline accidentals', () => {
    const source = 'b(b)C';
    const ast = parseAretino(source);
    const note = ast.lines[0].tokens[0].groups[0][1];

    expect(note.accidental.srcStart).toBe(1);
    expect(note.accidental.srcEnd).toBe(4);
    expect(note.srcStart).toBe(4);
    expect(note.srcEnd).toBe(5);
  });

  it('records a source span for each note modifier', () => {
    const source = 'g-.';
    const ast = parseAretino(source);
    const note = ast.lines[0].tokens[0].groups[0][0];

    expect(note.modifiers).toEqual(['ictus', 'mora']);
    expect(note.modifierSpans).toEqual([
      { srcStart: 1, srcEnd: 2 },
      { srcStart: 2, srcEnd: 3 },
    ]);
  });

  it('keeps modifier spans aligned when virga interleaves', () => {
    const source = "g'_.";
    const ast = parseAretino(source);
    const note = ast.lines[0].tokens[0].groups[0][0];

    expect(note.virga).toBe(true);
    expect(note.modifiers).toEqual(['episema', 'mora']);
    // The virga (') at offset 1 carries no glyph, so spans skip it.
    expect(note.modifierSpans).toEqual([
      { srcStart: 2, srcEnd: 3 },
      { srcStart: 3, srcEnd: 4 },
    ]);
  });

  // TODO: port representative parser assertions from cantores.hu fixtures.
});

describe('inline comments and preprocessor directives', () => {
  it('strips rest-of-line % comment from a music line', () => {
    const ast = parseAretino('fga % this is a comment\nhij');
    expect(ast.lines).toHaveLength(2);
    expect(ast.lines[0].type).toBe('music');
    const types = ast.lines[0].tokens.map(t => t.type);
    expect(types).toContain('ligature');
    // no spurious tokens from the comment text
    expect(types.filter(t => t !== 'ligature')).toHaveLength(0);
    expect(ast.lines[1].type).toBe('music');
  });

  it('parses ^ / v octave-shift markers into note.octaveShift', () => {
    const ast = parseAretino('(g2) ^a vg ^^c g');
    const notes = ast.lines[0].tokens
      .filter(t => t.type === 'ligature')
      .map(t => t.groups[0][0]);
    expect(notes.map(n => [n.pitch, n.octaveShift])).toEqual([
      ['a', 1],   // ^a  — one octave up
      ['g', -1],  // vg  — one octave down
      ['c', 2],   // ^^c — two octaves up
      ['g', undefined], // plain note carries no octaveShift field
    ]);
  });

  it('keeps shifted notes inside the same ligature and spans the markers', () => {
    const src = '(g2) g^a^bg';
    const ast = parseAretino(src);
    const lig = ast.lines[0].tokens.find(t => t.type === 'ligature');
    expect(lig.groups[0].map(n => [n.pitch, n.octaveShift ?? 0]))
      .toEqual([['g', 0], ['a', 1], ['b', 1], ['g', 0]]);
    // The token span starts at the first note and the ^a note span covers its marker.
    expect(lig.srcStart).toBe(src.indexOf('g^a'));
    expect(lig.groups[0][1].srcStart).toBe(src.indexOf('^a'));
  });

  it('skips a stray ^ / v not followed by a pitch letter', () => {
    const ast = parseAretino('(g2) ^ v g');
    const ligs = ast.lines[0].tokens.filter(t => t.type === 'ligature');
    expect(ligs).toHaveLength(1);
    expect(ligs[0].groups[0][0]).toMatchObject({ pitch: 'g' });
    expect(ligs[0].groups[0][0].octaveShift).toBeUndefined();
  });

  it('strips inline block comment %[ ... %] from a music line', () => {
    const ast = parseAretino('fga %[ a comment %] gab');
    expect(ast.lines[0].type).toBe('music');
    const ligatures = ast.lines[0].tokens.filter(t => t.type === 'ligature');
    expect(ligatures).toHaveLength(2);
    expect(ast.lines[0].tokens.some(t => t.type === 'inline-directive')).toBe(false);
  });

  it('emits inline-directive token for %[ key: value %] inside a music line', () => {
    const ast = parseAretino('fga %[ 169:(z) %] %[ 43:(Z) %] hij');
    const tokens = ast.lines[0].tokens;
    const dirs = tokens.filter(t => t.type === 'inline-directive');
    expect(dirs).toHaveLength(2);
    expect(dirs[0].key).toBe('169');
    expect(dirs[0].value).toBe('(z)');
    expect(dirs[1].key).toBe('43');
    expect(dirs[1].value).toBe('(Z)');
  });

  it('inline-directive preserves srcStart/srcEnd', () => {
    const src = 'fga %[ 169:(z) %] hij';
    const ast = parseAretino(src);
    const dir = ast.lines[0].tokens.find(t => t.type === 'inline-directive');
    expect(dir.srcStart).toBe(src.indexOf('%['));
    expect(dir.srcEnd).toBe(src.indexOf('%]') + 2);
  });

  it('emits preprocessor line for %[ key: value %] as a standalone body line', () => {
    const ast = parseAretino('%[ preprocessorSomething: a b c"Academic" %]');
    expect(ast.lines[0].type).toBe('preprocessor');
    expect(ast.lines[0].key).toBe('preprocessorSomething');
    expect(ast.lines[0].value).toBe('a b c"Academic"');
  });

  it('skips plain block comment line %[ no colon %]', () => {
    const ast = parseAretino('fga\n%[ just a comment %]\nhij');
    const musicLines = ast.lines.filter(l => l.type === 'music');
    expect(musicLines).toHaveLength(2);
    expect(ast.lines.some(l => l.type === 'preprocessor')).toBe(false);
  });

  it('skips plain % comment lines in the body', () => {
    const ast = parseAretino('fga\n% just a comment\nhij');
    const musicLines = ast.lines.filter(l => l.type === 'music');
    expect(musicLines).toHaveLength(2);
  });

  it('handles multi-line block comments', () => {
    const ast = parseAretino('fga\n%[ this is\na multi-line\ncomment\n%]\ngab');
    const musicLines = ast.lines.filter(l => l.type === 'music');
    expect(musicLines).toHaveLength(2);
    expect(musicLines[0].tokens.find(t => t.type === 'ligature')).toBeDefined();
    expect(musicLines[1].tokens.find(t => t.type === 'ligature')).toBeDefined();
  });

  it('processes music tokens that appear after %] on the closing line', () => {
    const ast = parseAretino('%[ comment\n%] gab');
    const musicLines = ast.lines.filter(l => l.type === 'music');
    expect(musicLines).toHaveLength(1);
    expect(musicLines[0].tokens.find(t => t.type === 'ligature')).toBeDefined();
  });

  it('treats %[ with no closing %] on same line as end-of-line comment in music', () => {
    const ast = parseAretino('fga %[ unclosed');
    // fga should be tokenised; the rest is treated as a comment
    const tokens = ast.lines[0].tokens;
    expect(tokens.find(t => t.type === 'ligature')).toBeDefined();
    expect(tokens.find(t => t.type === 'inline-directive')).toBeUndefined();
  });
});

describe('matchAccidental', () => {
  it('parses the current spelling (b flat / n natural / # sharp)', () => {
    expect(matchAccidental('fb')).toEqual({ pitch: 'f', symbol: 'x' });
    expect(matchAccidental('fn')).toEqual({ pitch: 'f', symbol: 'y' });
    expect(matchAccidental('f#')).toEqual({ pitch: 'f', symbol: '#' });
  });

  it('defaults the omitted pitch to the reciting position (b)', () => {
    expect(matchAccidental('b')).toEqual({ pitch: 'b', symbol: 'x' });
    expect(matchAccidental('n')).toEqual({ pitch: 'b', symbol: 'y' });
    expect(matchAccidental('#')).toEqual({ pitch: 'b', symbol: '#' });
  });

  it('rejects the former legacy Gregorio spelling (bx / by / b#)', () => {
    expect(matchAccidental('fbx')).toBeNull();
    expect(matchAccidental('fby')).toBeNull();
    expect(matchAccidental('fb#')).toBeNull();
    expect(matchAccidental('bx')).toBeNull();
  });

  it('handles a flat/natural targeting the b staff position', () => {
    expect(matchAccidental('bb')).toEqual({ pitch: 'b', symbol: 'x' });
    expect(matchAccidental('bn')).toEqual({ pitch: 'b', symbol: 'y' });
  });

  it('rejects non-accidental directives', () => {
    expect(matchAccidental('g2')).toBeNull();
    expect(matchAccidental('K:fb')).toBeNull();
    expect(matchAccidental('sp2')).toBeNull();
  });

  it('handles uppercase pitch letters as distinct note positions', () => {
    expect(matchAccidental('Fb')).toEqual({ pitch: 'F', symbol: 'x' });
    expect(matchAccidental('Fn')).toEqual({ pitch: 'F', symbol: 'y' });
    expect(matchAccidental('F#')).toEqual({ pitch: 'F', symbol: '#' });
    expect(matchAccidental('Bb')).toEqual({ pitch: 'B', symbol: 'x' });
    expect(matchAccidental('Ab')).toEqual({ pitch: 'A', symbol: 'x' });
    expect(matchAccidental('Gb')).toEqual({ pitch: 'G', symbol: 'x' });
  });
});

describe('W: text blocks', () => {
  const verses = src => parseAretino(src).lines.filter(l => l.type === 'verse');

  it('captures a parenthesised style name', () => {
    expect(verses('W(prose): szöveg')[0].style).toBe('prose');
    expect(verses('W(stanza): szöveg')[0].style).toBe('stanza');
  });

  it('leaves a plain W: block without a style', () => {
    expect(verses('W: szöveg')[0].style).toBeNull();
  });

  it('keeps an unknown style name rather than failing the parse', () => {
    const [item] = verses('W(bogus): szöveg');

    expect(item.style).toBe('bogus');
    expect(item.lines).toEqual(['szöveg']);
  });

  it('records a source span per input line and for the block', () => {
    const source = 'W(stanza): első\nmásodik';
    const [item] = verses(source);

    expect(item.lines).toEqual(['első', 'második']);
    expect(item.spans).toEqual([
      { srcStart: source.indexOf('első'), srcEnd: source.indexOf('első') + 4 },
      { srcStart: source.indexOf('második'), srcEnd: source.indexOf('második') + 7 },
    ]);
    expect(item.srcStart).toBe(source.indexOf('első'));
    expect(item.srcEnd).toBe(source.length);
  });

  it('does not treat a lowercase w( line as a styled text block', () => {
    expect(verses('w(prose): szöveg')).toHaveLength(0);
  });
});
