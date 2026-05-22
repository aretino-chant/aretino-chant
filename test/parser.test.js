import { describe, it, expect } from 'vitest';
import { parseAretino, matchAccidental } from '../src/index.js';

describe('parseAretino', () => {
  it('returns an object for empty input', () => {
    const ast = parseAretino('');
    expect(ast).toBeTypeOf('object');
  });

  // TODO: port representative parser assertions from cantores.hu fixtures.
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
