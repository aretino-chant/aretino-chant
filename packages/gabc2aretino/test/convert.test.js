import { describe, expect, it } from 'vitest';
import { gabcToAretino } from '../src/convert.js';

function musicLine(source) {
    return gabcToAretino(source).split('\n')[0];
}

describe('gabcToAretino pitch conversion', () => {
    it('preserves notes at and above the top of the Aretino letter range', () => {
        expect(musicLine('(c2) (abcdefghijklm)'))
            .toBe('(g2) efgabCDEFG^a^b^C');
    });

    it('preserves notes below the bottom of the Aretino letter range', () => {
        expect(musicLine('(f3) (abcdefghijklm)'))
            .toBe('(g2) vfvgABcdefgabCD');
    });

    it('preserves shifted-note modifiers', () => {
        expect(musicLine('(c2) (j~)(kW)(l.)(m_)'))
            .toBe("(g2) Gs ^aw' ^b. ^C_");
        expect(musicLine('(f3) (-a)(bW)(a.)(b_)'))
            .toBe("(g2) vfs vgw' vf. vg_");
    });

    it('does not drop the high notes in the reported c2 example', () => {
        expect(gabcToAretino('(c2) in(hj~)cén(j)sum(j_g/hg..)'))
            .toBe('(g2) EGs G G_D/E.D.\nw: in-cén-sum');
    });

    it.each([
        ['c1', 'vgABcdefgabCDE'],
        ['c2', 'efgabCDEFG^a^b^C'],
        ['c3', 'cdefgabCDEFG^a'],
        ['c4', 'ABcdefgabCDEF'],
        ['f3', 'vfvgABcdefgabCD'],
        ['f4', 'defgabCDEFG^a^b'],
        ['cb3', '(K:b) cdefgabCDEFG^a'],
        ['cb4', '(K:b) ABcdefgabCDEF'],
    ])('covers the complete GABC range under the %s clef', (clef, expected) => {
        expect(musicLine(`(${clef}) (abcdefghijklm)`))
            .toBe(`(g2) ${expected}`);
    });
});
