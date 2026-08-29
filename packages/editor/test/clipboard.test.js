import { describe, expect, it } from 'vitest';
import { convertHtmlPaste, escapeAretinoLiteral } from '../src/clipboard.js';

describe('escapeAretinoLiteral', () => {
    it('escapes the inline-formatting special characters', () => {
        expect(escapeAretinoLiteral('{a} <b> [c] d+e \\f')).toBe('\\{a\\} \\<b\\> \\[c\\] d\\+e \\\\f');
    });

    it('leaves | alone unless pipe is requested', () => {
        expect(escapeAretinoLiteral('a|b')).toBe('a|b');
        expect(escapeAretinoLiteral('a|b', { pipe: true })).toBe('a\\|b');
    });

    it('leaves ordinary text untouched', () => {
        expect(escapeAretinoLiteral('Al-le-lu-ia, o~jöjj!')).toBe('Al-le-lu-ia, o~jöjj!');
    });
});

describe('convertHtmlPaste', () => {
    it('returns null for empty or missing HTML', () => {
        expect(convertHtmlPaste('', 'lyric')).toBeNull();
        expect(convertHtmlPaste(null, 'lyric')).toBeNull();
        expect(convertHtmlPaste(undefined, 'lyric')).toBeNull();
    });

    it('returns null when the HTML carries no character formatting', () => {
        expect(convertHtmlPaste('<p>Plain text, nothing styled</p>', 'verse')).toBeNull();
        expect(convertHtmlPaste('plain text', 'lyric')).toBeNull();
    });

    it('converts <b>/<strong> to bold', () => {
        expect(convertHtmlPaste('<b>bold</b> word', 'lyric')).toBe('{bold} word');
        expect(convertHtmlPaste('word <strong>bold</strong>', 'lyric')).toBe('word {bold}');
    });

    it('converts <i>/<em> to italic', () => {
        expect(convertHtmlPaste('<i>italic</i> word', 'lyric')).toBe('<italic> word');
        expect(convertHtmlPaste('word <em>italic</em>', 'lyric')).toBe('word <italic>');
    });

    it('converts <u> to underline', () => {
        expect(convertHtmlPaste('<u>underlined</u> word', 'lyric')).toBe('[underlined] word');
    });

    it('nests formatting the way Aretino syntax expects', () => {
        expect(convertHtmlPaste('<b><i>both</i></b>', 'lyric')).toBe('{<both>}');
        expect(convertHtmlPaste('<u><b>x</b> plain</u>', 'lyric')).toBe('[{x} plain]');
    });

    it('recognises inline-style bold/italic/underline as well as tags', () => {
        expect(convertHtmlPaste('<span style="font-weight:700">bold</span>', 'lyric')).toBe('{bold}');
        expect(convertHtmlPaste('<span style="font-weight: bold">bold</span>', 'lyric')).toBe('{bold}');
        expect(convertHtmlPaste('<span style="font-style:italic">italic</span>', 'lyric')).toBe('<italic>');
        expect(convertHtmlPaste('<span style="text-decoration: underline">u</span>', 'lyric')).toBe('[u]');
        // A merely medium weight shouldn't read as bold.
        expect(convertHtmlPaste('<span style="font-weight:400">plain <b>bold</b></span>', 'lyric')).toBe('plain {bold}');
    });

    it('converts colors from style and from <font color>', () => {
        expect(convertHtmlPaste('<span style="color:#ff0000">red</span>', 'lyric')).toBe('\\color:#ff0000{red}');
        expect(convertHtmlPaste('<span style="color: rgb(0, 128, 0)">green</span>', 'lyric')).toBe('\\color:rgb(0, 128, 0){green}');
        expect(convertHtmlPaste('<font color="blue">blue</font>', 'lyric')).toBe('\\color:blue{blue}');
    });

    it('escapes Aretino special characters found in the pasted text', () => {
        expect(convertHtmlPaste('<b>{bold} &amp; &lt;tricky&gt; text+</b>', 'lyric'))
            .toBe('{\\{bold\\} & \\<tricky\\> text\\+}');
    });

    it('decodes HTML entities', () => {
        expect(convertHtmlPaste('<b>caf&eacute;</b>'.replace('&eacute;', '&#233;'), 'lyric')).toBe('{café}');
        expect(convertHtmlPaste('<b>a&amp;b</b>', 'lyric')).toBe('{a&b}');
    });

    it('joins block-level elements with a space in lyric context', () => {
        expect(convertHtmlPaste('<p>First</p><p>Second <b>bold</b></p>', 'lyric')).toBe('First Second {bold}');
    });

    it('joins block-level elements and <br> with " | " in verse context', () => {
        expect(convertHtmlPaste('<p>First <b>x</b></p><p>Second</p>', 'verse')).toBe('First {x} | Second');
        expect(convertHtmlPaste('Line one<b>!</b><br>Line two', 'verse')).toBe('Line one{!} | Line two');
    });

    it('joins block-level elements with " | " in heading context too', () => {
        expect(convertHtmlPaste('<div>Title <i>part</i></div><div>Subtitle</div>', 'heading')).toBe('Title <part> | Subtitle');
    });

    it('escapes a literal | in verse/heading text but not in lyric text', () => {
        expect(convertHtmlPaste('<b>a|b</b>', 'verse')).toBe('{a\\|b}');
        expect(convertHtmlPaste('<b>a|b</b>', 'heading')).toBe('{a\\|b}');
        expect(convertHtmlPaste('<b>a|b</b>', 'lyric')).toBe('{a|b}');
    });

    it('drops empty blocks instead of emitting stray break tokens', () => {
        expect(convertHtmlPaste('<p><b>a</b></p><p></p><p><b>b</b></p>', 'verse')).toBe('{a} | {b}');
    });

    it('honors Office/Google-Docs StartFragment/EndFragment markers', () => {
        const html = '<html><head><style>.x{color:red}</style></head><body>'
            + '<!--StartFragment--><b>kept</b><!--EndFragment-->'
            + '<p>not part of the selection</p></body></html>';
        expect(convertHtmlPaste(html, 'lyric')).toBe('{kept}');
    });

    it('drops <script> and <style> content', () => {
        expect(convertHtmlPaste('<style>.x{color:red}</style><b>bold</b>', 'lyric')).toBe('{bold}');
        expect(convertHtmlPaste('<script>alert(1)</script><b>bold</b>', 'lyric')).toBe('{bold}');
    });

    it('passes through unknown/unstyled tags without wrapping', () => {
        expect(convertHtmlPaste('<span>plain <b>bold</b></span>', 'lyric')).toBe('plain {bold}');
    });

    it('does not throw on malformed markup', () => {
        expect(() => convertHtmlPaste('<b>unterminated bold', 'lyric')).not.toThrow();
        expect(convertHtmlPaste('<b>unterminated bold', 'lyric')).toBe('{unterminated bold}');
        expect(() => convertHtmlPaste('<b>close</i></b> mismatched', 'lyric')).not.toThrow();
    });

    it('collapses internal whitespace/newlines like a browser would', () => {
        expect(convertHtmlPaste('<b>a\n   b\t\tc</b>', 'lyric')).toBe('{a b c}');
    });
});
