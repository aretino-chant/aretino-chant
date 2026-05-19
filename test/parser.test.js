import { describe, it, expect } from 'vitest';
import { parseAretino } from '../src/index.js';

describe('parseAretino', () => {
  it('returns an object for empty input', () => {
    const ast = parseAretino('');
    expect(ast).toBeTypeOf('object');
  });

  // TODO: port representative parser assertions from cantores.hu fixtures.
});
