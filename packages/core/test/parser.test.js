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

  it('strips inline block comment %[ ... %] from a music line', () => {
    const ast = parseAretino('fga %[ a comment %] hij');
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

  it('emits pagebreak node for %pagebreakXXX', () => {
    const ast = parseAretino('%pagebreak169');
    expect(ast.lines[0].type).toBe('pagebreak');
    expect(ast.lines[0].id).toBe('169');
  });

  it('ignores trailing text after %pagebreakID', () => {
    const ast = parseAretino('%pagebreak169 - for projector');
    expect(ast.lines[0].type).toBe('pagebreak');
    expect(ast.lines[0].id).toBe('169');
  });

  it('skips plain % comment lines in the body', () => {
    const ast = parseAretino('fga\n% just a comment\nhij');
    const musicLines = ast.lines.filter(l => l.type === 'music');
    expect(musicLines).toHaveLength(2);
  });

  it('handles multi-line block comments', () => {
    const ast = parseAretino('fga\n%[ this is\na multi-line\ncomment\n%]\nhij');
    const musicLines = ast.lines.filter(l => l.type === 'music');
    expect(musicLines).toHaveLength(2);
    expect(musicLines[0].tokens.find(t => t.type === 'ligature')).toBeDefined();
    expect(musicLines[1].tokens.find(t => t.type === 'ligature')).toBeDefined();
  });

  it('processes music tokens that appear after %] on the closing line', () => {
    const ast = parseAretino('%[ comment\n%] hij');
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

  it('defaults the omitted pitch to the reciting position (i)', () => {
    expect(matchAccidental('b')).toEqual({ pitch: 'i', symbol: 'x' });
    expect(matchAccidental('n')).toEqual({ pitch: 'i', symbol: 'y' });
    expect(matchAccidental('#')).toEqual({ pitch: 'i', symbol: '#' });
  });

  it('rejects the former legacy Gregorio spelling (bx / by / b#)', () => {
    expect(matchAccidental('fbx')).toBeNull();
    expect(matchAccidental('fby')).toBeNull();
    expect(matchAccidental('fb#')).toBeNull();
    expect(matchAccidental('bx')).toBeNull();
  });

  it('handles a flat/natural targeting the b or n staff position', () => {
    expect(matchAccidental('bb')).toEqual({ pitch: 'b', symbol: 'x' });
    expect(matchAccidental('nn')).toEqual({ pitch: 'n', symbol: 'y' });
    expect(matchAccidental('bn')).toEqual({ pitch: 'b', symbol: 'y' });
  });

  it('rejects non-accidental directives', () => {
    expect(matchAccidental('g2')).toBeNull();
    expect(matchAccidental('K:fb')).toBeNull();
    expect(matchAccidental('sp2')).toBeNull();
  });

  it('handles uppercase pitch letters to indicate octave shift', () => {
    expect(matchAccidental('Fb')).toEqual({ pitch: 'f', symbol: 'x', high: true });
    expect(matchAccidental('Fn')).toEqual({ pitch: 'f', symbol: 'y', high: true });
    expect(matchAccidental('F#')).toEqual({ pitch: 'f', symbol: '#', high: true });
    expect(matchAccidental('Bb')).toEqual({ pitch: 'b', symbol: 'x', high: true });
    expect(matchAccidental('Nn')).toEqual({ pitch: 'n', symbol: 'y', high: true });
  });
});
