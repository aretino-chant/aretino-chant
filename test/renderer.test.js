import { describe, it, expect } from 'vitest';
import { parseAretino, renderAretino } from '../src/index.js';

describe('renderAretino', () => {
  it('produces a string containing <svg', () => {
    const ast = parseAretino('');
    const svg = renderAretino(ast);
    expect(svg).toBeTypeOf('string');
    expect(svg).toContain('<svg');
  });

  // TODO: snapshot a known sample once examples/sample.aretino is filled in.
});
