import { describe, it, expect } from 'vitest';
import { guidoTextToAretino } from '../src/convert.js';

describe('guidoTextToAretino', () => {
    it('collapses runs of hyphens into a single break', () => {
        expect(guidoTextToAretino('Hús-----vét')).toBe('Hús-vét');
        expect(guidoTextToAretino('lá------------bát')).toBe('lá-bát');
    });

    it('collapses runs of spaces into a single space', () => {
        expect(guidoTextToAretino('ün-ne--pe  e-lőtt')).toBe('ün-ne-pe e-lőtt');
    });

    it('converts _ to a nonbreaking space (~)', () => {
        expect(guidoTextToAretino('s_mos-ni')).toBe('s~mos-ni');
    });

    it('converts @ to a nonbreaking space (~)', () => {
        expect(guidoTextToAretino('e-lőtt      @       tör---tént'))
            .toBe('e-lőtt ~ tör-tént');
    });

    it('converts text markers to parenthesized Aretino markers', () => {
        expect(guidoTextToAretino('Al-le-lu-ja * †')).toBe('Al-le-lu-ja (*) (†)');
    });

    it('collapses tabs and non-breaking spaces too', () => {
        expect(guidoTextToAretino('a\t  b')).toBe('a b');
    });

    it('trims leading/trailing whitespace but preserves newlines', () => {
        expect(guidoTextToAretino('  hello  ')).toBe('hello');
        expect(guidoTextToAretino('a   \n   b')).toBe('a\nb');
    });

    it('handles the full opening passage of the spec example', () => {
        const input =
            'Hús-----vét   ün-ne--pe  e-lőtt      @       tör---------tént: ' +
            'Tud----ván Jé-zus, hogy az Ő     ó---rá--ja  el----------jött, ' +
            's_mos-ni kezd-te  a ta-nít-vá-nyok lá-------------------bát.';
        const expected =
            'Hús-vét ün-ne-pe e-lőtt ~ tör-tént: ' +
            'Tud-ván Jé-zus, hogy az Ő ó-rá-ja el-jött, ' +
            's~mos-ni kezd-te a ta-nít-vá-nyok lá-bát.';
        expect(guidoTextToAretino(input)).toBe(expected);
    });
});
